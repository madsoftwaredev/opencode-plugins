import { buildReport, type UsageMessage, type UsageReport, type UsageSession } from "./usage.ts";
import { createPriceBook, type PriceBook, type PricingModel } from "./pricing.ts";

type Page<T> = { readonly data: readonly T[]; readonly cursor: { readonly next?: string | null } };
type Options = { readonly signal: AbortSignal };

/** The subset of the host client used by this read-only plugin. */
export type UsageClient = {
  readonly model: {
    list(
      input: { location?: { directory?: string } } | undefined,
      options: Options
    ): Promise<{ readonly data: readonly PricingModel[] }>;
  };
  readonly session: {
    get(input: { sessionID: string }, options: Options): Promise<UsageSession>;
    list(
      input: { parentID?: string; limit: number; order?: "desc"; cursor?: string },
      options: Options
    ): Promise<Page<UsageSession>>;
  };
  readonly message: {
    list(
      input: { sessionID: string; limit: number; order?: "desc"; cursor?: string },
      options: Options
    ): Promise<Page<UsageMessage>>;
  };
};

export type Family = { readonly sessions: UsageSession[]; readonly warnings: string[] };

/** Cursor pages inherit their original filters and order; do not send order alongside a cursor. */
export function pageInput(cursor?: string): { limit: number; order?: "desc"; cursor?: string } {
  return cursor ? { limit: 200, cursor } : { limit: 200, order: "desc" };
}

async function pages<T>(
  fetch: (cursor?: string) => Promise<Page<T>>,
  signal: AbortSignal
): Promise<T[]> {
  const items: T[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    signal.throwIfAborted();
    const page = await fetch(cursor);
    items.push(...page.data);
    cursor = page.cursor.next ?? undefined;
    if (cursor && cursors.has(cursor))
      throw new Error("opencode-usage: repeated pagination cursor");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return items;
}

/** Finds every descendant, including older, nested, archived, and cross-location subagents. */
export async function loadFamily(
  client: UsageClient,
  sessionID: string,
  includeSubagents: boolean,
  signal: AbortSignal
): Promise<Family> {
  signal.throwIfAborted();
  const root = await client.session.get({ sessionID }, { signal });
  const sessions = [root];
  const warnings: string[] = [];
  const seen = new Set([root.id]);
  if (!includeSubagents) return { sessions, warnings };

  for (let index = 0; index < sessions.length; ) {
    const batch = sessions.slice(index, index + 4);
    index += batch.length;
    const children = await Promise.all(
      batch.map(async (parent) => {
        try {
          return await pages(
            (cursor) =>
              client.session.list(
                cursor ? pageInput(cursor) : { parentID: parent.id, ...pageInput() },
                { signal }
              ),
            signal
          );
        } catch (error) {
          if (signal.aborted) throw error;
          warnings.push(`Subagents of ${parent.id} could not be loaded. Totals may be incomplete.`);
          return [];
        }
      })
    );

    for (let i = 0; i < batch.length; i += 1) {
      for (const child of children[i]) {
        if (child.parentID !== batch[i].id || seen.has(child.id)) continue;
        seen.add(child.id);
        sessions.push(child);
      }
    }
  }
  return { sessions, warnings };
}

function accountingFields(message: UsageMessage): UsageMessage {
  const { id, type, model, tokens, cost } = message;
  return { id, type, model, tokens, cost };
}

/** Loads all accounting history once, then replaces recent pages rather than accumulating usage events. */
export async function loadMessages(
  client: UsageClient,
  sessionID: string,
  signal: AbortSignal,
  previous?: readonly UsageMessage[]
): Promise<UsageMessage[]> {
  const known = new Set(previous?.map((message) => message.id));
  const fetched = new Map<string, UsageMessage>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let overlap = false;
  do {
    signal.throwIfAborted();
    const page = await client.message.list({ sessionID, ...pageInput(cursor) }, { signal });
    for (const message of page.data) fetched.set(message.id, accountingFields(message));
    overlap = page.data.some((message) => known.has(message.id));
    cursor = page.cursor.next ?? undefined;
    if (!cursor || overlap) break;
    if (cursors.has(cursor)) throw new Error("opencode-usage: repeated message cursor");
    cursors.add(cursor);
  } while (cursor);

  const retained = overlap ? (previous ?? []).filter((message) => !fetched.has(message.id)) : [];
  return [...retained, ...fetched.values()];
}

export type Snapshot = {
  readonly sessionID: string;
  readonly report?: UsageReport;
  readonly loading: boolean;
  readonly detailed: boolean;
  readonly warnings: readonly string[];
  readonly updatedAt?: number;
};

type Run = {
  sessionID: string;
  includeSubagents: boolean;
  controller: AbortController;
  family?: Family;
  prices?: PriceBook;
  histories: Map<string, UsageMessage[]>;
  errors: Map<string, string>;
  dirty: Set<string>;
  topology: boolean;
  fullHistory: boolean;
  detailed: boolean;
  pending: boolean;
  running: boolean;
  updatedAt?: number;
  timer?: ReturnType<typeof setTimeout>;
};

const REFRESH_EVENTS = new Set([
  "session.usage.updated",
  "session.step.ended",
  "session.step.failed",
  "session.compaction.ended",
  "session.compaction.failed",
  "session.renamed",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.revert.committed",
]);

/** One active-chat resource shared by the sidebar and popup; old requests cannot publish into a new chat. */
export function createUsageTracker(
  client: UsageClient,
  publish: (snapshot?: Snapshot) => void,
  location?: { directory?: string }
) {
  let current: Run | undefined;

  const emit = (run: Run) => {
    if (run !== current || run.controller.signal.aborted) return;
    // A throw while building the report would otherwise escape through the
    // `void drain(run)` call sites as an unhandled rejection: running would
    // never reset, every later refresh would short-circuit on it, and the
    // UI would show a permanent, silent loading state. Degrade to a warning
    // and keep the tracker usable instead.
    let report: UsageReport | undefined;
    let reportWarning: string | undefined;
    try {
      report = run.family ? buildReport(run.family.sessions, run.histories, run.prices) : undefined;
    } catch (error) {
      console.warn("[opencode-usage] Could not build the usage report", error);
      reportWarning = `Could not compute the usage report (${String(error)}).`;
    }
    publish({
      sessionID: run.sessionID,
      report,
      loading: run.running,
      detailed: run.detailed,
      updatedAt: run.updatedAt,
      warnings: [...(run.family?.warnings ?? []), ...run.errors.values(), ...(reportWarning ? [reportWarning] : [])],
    });
  };

  const drain = async (run: Run) => {
    if (run.running || run.controller.signal.aborted) return;
    run.running = true;
    emit(run);
    const signal = run.controller.signal;
    do {
      run.pending = false;
      const topology = run.topology;
      const fullHistory = run.fullHistory;
      const dirty = new Set(run.dirty);
      run.dirty.clear();
      run.topology = false;
      run.fullHistory = false;
      try {
        if (topology || !run.family) {
          const family = await loadFamily(client, run.sessionID, run.includeSubagents, signal);
          signal.throwIfAborted();
          const previous = new Map(run.family?.sessions.map((session) => [session.id, session]));
          for (const session of family.sessions) {
            const saved = previous.get(session.id);
            run.errors.delete(session.id);
            if (
              !saved ||
              saved.cost !== session.cost ||
              JSON.stringify(saved.tokens) !== JSON.stringify(session.tokens)
            ) {
              dirty.add(session.id);
            }
          }
          run.family = family;
          run.errors.delete("family");
          const ids = new Set(family.sessions.map((session) => session.id));
          for (const id of run.histories.keys()) if (!ids.has(id)) run.histories.delete(id);
          for (const key of run.errors.keys())
            if (key !== "family" && key !== "prices" && !ids.has(key.replace(/^messages:/, "")))
              run.errors.delete(key);
        } else {
          for (const id of dirty) {
            try {
              const session = await client.session.get({ sessionID: id }, { signal });
              signal.throwIfAborted();
              run.family = {
                ...run.family,
                sessions: run.family.sessions.map((saved) => (saved.id === id ? session : saved)),
              };
              run.errors.delete(id);
            } catch (error) {
              if (signal.aborted) throw error;
              run.errors.set(
                id,
                `Usage for ${id} could not be refreshed. Showing the last loaded values.`
              );
            }
          }
        }

        if (!run.prices || fullHistory) {
          try {
            const catalog = await client.model.list(location ? { location } : undefined, {
              signal,
            });
            signal.throwIfAborted();
            const prices = createPriceBook(catalog.data);
            run.prices = catalog.data.length ? prices : undefined;
            run.errors.delete("prices");
          } catch (error) {
            if (signal.aborted) throw error;
            console.warn("[opencode-usage] Could not load API prices", error);
            run.errors.set(
              "prices",
              "API prices are unavailable or stale; actual recorded charges are unchanged."
            );
          }
        }

        {
          // Bound concurrency so a large subagent tree does not flood the connected server.
          const sessions = run.family.sessions.filter(
            (session) =>
              fullHistory ||
              dirty.has(session.id) ||
              !run.histories.has(session.id) ||
              run.errors.has(`messages:${session.id}`)
          );
          for (let i = 0; i < sessions.length; i += 4) {
            await Promise.all(
              sessions.slice(i, i + 4).map(async (session) => {
                try {
                  const messages = await loadMessages(
                    client,
                    session.id,
                    signal,
                    fullHistory ? undefined : run.histories.get(session.id)
                  );
                  signal.throwIfAborted();
                  run.histories.set(session.id, messages);
                  run.errors.delete(`messages:${session.id}`);
                } catch (error) {
                  if (signal.aborted) throw error;
                  run.errors.set(
                    `messages:${session.id}`,
                    `Model detail for ${session.id} is unavailable or stale.`
                  );
                }
              })
            );
          }
        }
        run.updatedAt = Date.now();
      } catch (error) {
        if (signal.aborted) return;
        console.warn("[opencode-usage] Could not load chat usage", error);
        run.errors.set("family", "Could not load chat usage. Press r in /usage to retry.");
        run.topology = true;
      }
    } while (run.pending && !signal.aborted);
    run.running = false;
    emit(run);
  };

  const queue = (run: Run, immediate = false) => {
    run.pending = true;
    if (run.running) return;
    if (run.timer) clearTimeout(run.timer);
    if (immediate) void drain(run);
    else
      run.timer = setTimeout(() => {
        run.timer = undefined;
        void drain(run);
      }, 250);
  };

  const dispose = () => {
    current?.controller.abort();
    if (current?.timer) clearTimeout(current.timer);
    current = undefined;
  };

  return {
    select(sessionID: string | undefined, includeSubagents = true) {
      if (sessionID === current?.sessionID && includeSubagents === current?.includeSubagents)
        return;
      dispose();
      if (!sessionID) {
        publish(undefined);
        return;
      }
      current = {
        sessionID,
        includeSubagents,
        controller: new AbortController(),
        histories: new Map(),
        errors: new Map(),
        dirty: new Set(),
        topology: true,
        fullHistory: false,
        detailed: false,
        pending: true,
        running: false,
      };
      queue(current, true);
    },
    details() {
      if (!current) return;
      current.detailed = true;
      current.topology = true;
      queue(current, true);
    },
    closeDetails() {
      if (!current) return;
      current.detailed = false;
      emit(current);
    },
    refresh() {
      if (!current) return;
      current.detailed = true;
      current.topology = true;
      current.fullHistory = true;
      queue(current, true);
    },
    resync() {
      if (!current) return;
      current.topology = true;
      queue(current, true);
    },
    changed(type: string, sessionID: string, parentID?: string) {
      const run = current;
      if (!run) return;
      const known = (id: string) =>
        id === run.sessionID || run.family?.sessions.some((session) => session.id === id);
      if (
        type === "session.created" &&
        run.includeSubagents &&
        parentID &&
        (known(parentID) || !run.family)
      ) {
        run.topology = true;
        queue(run);
      } else if (known(sessionID) && (type === "session.deleted" || REFRESH_EVENTS.has(type))) {
        if (type === "session.deleted") run.topology = true;
        else run.dirty.add(sessionID);
        if (type === "session.revert.committed") {
          run.histories.delete(sessionID);
          run.fullHistory = true;
        }
        queue(run);
      }
    },
    dispose,
  };
}
