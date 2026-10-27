import {
  emptyApiCost,
  estimateApiCost,
  type ApiCost,
  type ApiPrice,
  type PriceBook,
} from "./pricing.ts";

export type Tokens = {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cache: { readonly read: number; readonly write: number };
};

export type Model = { readonly providerID: string; readonly id: string; readonly variant?: string };

export type UsageSession = {
  readonly id: string;
  readonly parentID?: string;
  readonly title?: string;
  readonly agent?: string;
  readonly fork?: { readonly sessionID: string };
  // Omitted by the server until an accounting step records usage.
  readonly tokens?: Tokens;
  readonly cost?: number;
};

/** Only accounting fields are retained; prompts and tool output are not cached. */
export type UsageMessage = {
  readonly id: string;
  readonly type: string;
  readonly model?: Model;
  readonly tokens?: Tokens;
  readonly cost?: number;
};

export type Metrics = {
  tokens: Tokens;
  /** OpenCode-recorded charges, never the counterfactual API price. */
  cost: number;
  api: ApiCost;
};

export type ModelRow = Metrics & {
  readonly model: Model;
  steps: number;
  compactions: number;
  missingCosts: number;
  readonly apiPrice?: ApiPrice;
};

export type SessionRow = Metrics & {
  readonly session: UsageSession;
  readonly models: ModelRow[];
  readonly unattributed: Metrics;
  readonly mismatch: boolean;
  readonly loaded: boolean;
};

export type UsageReport = {
  readonly total: Metrics;
  readonly main: Metrics;
  readonly subagents: Metrics;
  readonly models: ModelRow[];
  readonly modelTotals: ModelRow[];
  readonly sessions: SessionRow[];
  readonly unattributed: Metrics;
  readonly mismatch: boolean;
};

export function emptyMetrics(): Metrics {
  return {
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0,
    api: emptyApiCost(),
  };
}

/** Matches OpenCode's normalized, disjoint token buckets, including reasoning and both caches. */
export function totalTokens(tokens: Tokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

/** The denominator is all input: uncached input plus cache reads and writes. */
export function cacheHitRate(tokens: Tokens): number | undefined {
  const input = tokens.input + tokens.cache.read + tokens.cache.write;
  return input > 0 ? tokens.cache.read / input : undefined;
}

const ZERO_TOKENS: Tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };

function add(target: Metrics, source: { tokens?: Tokens; cost?: number; api?: ApiCost }): void {
  // A session that never completed an accounting step or a step that failed
  // before the provider recorded usage can arrive here with no tokens/cost.
  // A wholly absent tokens object or cost (null/undefined only — NaN still
  // trips the guard below) folds in as zero: nothing recorded is nothing
  // spent. A TypeError here would be fatal — see the emit() guard in data.ts.
  const tokens = source.tokens ?? ZERO_TOKENS;
  const cost = source.cost ?? 0;
  const values = [cost, tokens.input, tokens.output, tokens.reasoning, tokens.cache.read, tokens.cache.write];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new TypeError("opencode-usage: invalid recorded usage");
  }

  target.cost += cost;
  if (source.api) {
    target.api.usd += source.api.usd;
    target.api.missingTokens += source.api.missingTokens;
    target.api.missingEntries += source.api.missingEntries;
  }
  target.tokens = {
    input: target.tokens.input + tokens.input,
    output: target.tokens.output + tokens.output,
    reasoning: target.tokens.reasoning + tokens.reasoning,
    cache: {
      read: target.tokens.cache.read + tokens.cache.read,
      write: target.tokens.cache.write + tokens.cache.write,
    },
  };
}

function modelKey(model: Model): string {
  return JSON.stringify([model.providerID, model.id, model.variant ?? null]);
}

function modelRow(model: Model, apiPrice?: ApiPrice): ModelRow {
  return { ...emptyMetrics(), model, apiPrice, steps: 0, compactions: 0, missingCosts: 0 };
}

function mergeModel(target: ModelRow, source: ModelRow): void {
  add(target, source);
  target.steps += source.steps;
  target.compactions += source.compactions;
  target.missingCosts += source.missingCosts;
}

function orderedModels(rows: Iterable<ModelRow>): ModelRow[] {
  return [...rows].sort(
    (a, b) =>
      b.cost - a.cost ||
      b.api.usd - a.api.usd ||
      totalTokens(b.tokens) - totalTokens(a.tokens) ||
      modelKey(a.model).localeCompare(modelKey(b.model))
  );
}

function remainder(
  recorded: Metrics,
  attributed: Metrics
): { metrics: Metrics; mismatch: boolean } {
  const delta = {
    cost: recorded.cost - attributed.cost,
    input: recorded.tokens.input - attributed.tokens.input,
    output: recorded.tokens.output - attributed.tokens.output,
    reasoning: recorded.tokens.reasoning - attributed.tokens.reasoning,
    read: recorded.tokens.cache.read - attributed.tokens.cache.read,
    write: recorded.tokens.cache.write - attributed.tokens.cache.write,
  };
  return {
    metrics: {
      api: emptyApiCost(),
      cost: Math.max(0, delta.cost),
      tokens: {
        input: Math.max(0, delta.input),
        output: Math.max(0, delta.output),
        reasoning: Math.max(0, delta.reasoning),
        cache: { read: Math.max(0, delta.read), write: Math.max(0, delta.write) },
      },
    },
    mismatch:
      delta.cost < -1e-8 ||
      [delta.input, delta.output, delta.reasoning, delta.read, delta.write].some(
        (value) => value < 0
      ),
  };
}

/** Session totals are authoritative. Unattributable overhead is never assigned to the selected model. */
export function buildReport(
  sessions: readonly UsageSession[],
  histories: ReadonlyMap<string, readonly UsageMessage[]>,
  prices?: PriceBook
): UsageReport {
  const total = emptyMetrics();
  const main = emptyMetrics();
  const subagents = emptyMetrics();
  const unattributed = emptyMetrics();
  const models = new Map<string, ModelRow>();
  const rows: SessionRow[] = [];
  const seen = new Set<string>();

  for (const session of sessions) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    const metrics = emptyMetrics();
    add(metrics, session);

    const ownModels = new Map<string, ModelRow>();
    const attributed = emptyMetrics();
    const messages = histories.get(session.id);
    const messageIDs = new Set<string>();
    for (const message of messages ?? []) {
      if (messageIDs.has(message.id)) continue;
      messageIDs.add(message.id);
      if (message.type !== "assistant" && message.type !== "compaction") continue;
      if (!message.model || (!message.tokens && message.cost === undefined)) continue;

      const key = modelKey(message.model);
      let row = ownModels.get(key);
      if (!row) {
        row = modelRow(message.model, prices?.resolve(message.model));
        ownModels.set(key, row);
      }
      const usage = {
        tokens: message.tokens ?? emptyMetrics().tokens,
        cost: message.cost ?? 0,
        api: message.tokens
          ? estimateApiCost(message.tokens, row.apiPrice)
          : { usd: 0, missingTokens: 0, missingEntries: 1 },
      };
      add(row, usage);
      add(attributed, usage);
      if (message.type === "assistant") row.steps += 1;
      else row.compactions += 1;
      if (message.cost === undefined) row.missingCosts += 1;
    }

    for (const [key, own] of ownModels) {
      let combined = models.get(key);
      if (!combined) {
        combined = modelRow(own.model, own.apiPrice);
        models.set(key, combined);
      }
      mergeModel(combined, own);
    }

    const rest = remainder(metrics, attributed);
    const missingTokens = totalTokens(rest.metrics.tokens);
    rest.metrics.api = {
      usd: 0,
      missingTokens,
      missingEntries: missingTokens > 0 || rest.metrics.cost > 1e-8 ? 1 : 0,
    };
    metrics.api = { ...attributed.api };
    metrics.api.missingTokens += rest.metrics.api.missingTokens;
    metrics.api.missingEntries += rest.metrics.api.missingEntries;
    add(total, metrics);
    add(rows.length === 0 ? main : subagents, metrics);
    if (messages) add(unattributed, rest.metrics);
    rows.push({
      ...metrics,
      session,
      models: orderedModels(ownModels.values()),
      unattributed: rest.metrics,
      mismatch: rest.mismatch,
      loaded: messages !== undefined,
    });
  }

  const modelTotals = new Map<string, ModelRow>();
  for (const row of models.values()) {
    const model = { providerID: row.model.providerID, id: row.model.id };
    const key = modelKey(model);
    let combined = modelTotals.get(key);
    if (!combined) {
      combined = modelRow(model, row.apiPrice);
      modelTotals.set(key, combined);
    }
    mergeModel(combined, row);
  }

  return {
    total,
    main,
    subagents,
    models: orderedModels(models.values()),
    modelTotals: orderedModels(modelTotals.values()),
    sessions: rows,
    unattributed,
    mismatch: rows.some((row) => row.mismatch),
  };
}

export function formatTokens(value: number, compact = false): string {
  if (!compact) return value.toLocaleString("en-US");
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}m`;
}

export function formatCost(cost: number, missing = false): string {
  if (missing) return "—";
  if (cost > 0 && cost < 0.0001) return "<$0.0001";
  return `$${cost.toFixed(cost < 1 ? 4 : 2)}`;
}

/** A plus sign is a known subtotal, not a fabricated zero for unpriced usage. */
export function formatApiCost(api: ApiCost): string {
  if (api.missingEntries || api.missingTokens) return api.usd > 0 ? `${formatCost(api.usd)}+` : "—";
  return formatCost(api.usd);
}

export function formatPercent(rate: number | undefined): string {
  return rate === undefined ? "—" : `${(rate * 100).toFixed(1)}%`;
}

export function modelLabel(model: Model): string {
  return `${model.providerID}/${model.id}${model.variant ? ` (${model.variant})` : ""}`;
}
