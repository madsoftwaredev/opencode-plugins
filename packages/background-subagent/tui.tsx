/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { activityLabel, activityStatus, isActive, oneLine, STATUS_MARKERS, type ActivitySession } from "./activity";

const MAX_VISIBLE_ROWS = 3;

// Product strip: left-aligned terminal monospace, bold identity/status, one-cell
// horizontal padding, no borders or animation. The primary-action header is the
// one bright surface; rows use raised surfaces and semantic outcome text.
// [ Subagents N   Open all ]
// [ ● running  agent: task ]  (at most three one-line rows)
// [ Dismiss inactive      ]  (only for retained, non-active rows)
function ActionLine(props: {
  context: Context;
  id: string;
  prominent?: boolean;
  onSelect: () => void;
  children: JSX.Element;
}) {
  const [hovered, setHovered] = createSignal(false);
  const variant = () => (props.prominent ? "primary" : "secondary");
  const state = () => (hovered() ? "hovered" : "base");
  const palette = {
    surface: () => props.context.theme.background.raised.base,
    actionSurface: () => props.context.theme.background.action[variant()][state()],
    actionText: () => props.context.theme.text.action[variant()][state()],
    text: () => props.context.theme.text.base,
  };

  return (
    <box
      id={props.id}
      width="100%"
      height={1}
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.prominent || hovered() ? palette.actionSurface() : palette.surface()}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        if (event.button !== 0) return;
        const selection = props.context.renderer.getSelection();
        if (event.isDragging && selection && (!selection.isStart || selection.behavior !== "cell")) return;
        // Open after the triggering release; otherwise it dismisses the new
        // dialog as an outside click. Discard only the click's empty selection
        // so the next outside click closes normally, while real drags still select.
        props.context.renderer.clearSelection();
        event.stopPropagation();
        props.onSelect();
      }}
    >
      <text
        width="100%"
        minWidth={0}
        height={1}
        wrapMode="none"
        // Native middle truncation can erase the agent's identity. Preserve the
        // start of the row; the picker provides the complete label.
        truncate={false}
        fg={props.prominent || hovered() ? palette.actionText() : palette.text()}
      >
        {props.children}
      </text>
    </box>
  );
}

function ActivityStrip(props: { context: Context; sessionID: string }) {
  const { context } = props;
  let disposed = false;
  let refreshing: Promise<void> | undefined;
  let previousActive = new Set<string>();
  const [tracked, setTracked] = createSignal(new Set<string>());
  const [unavailable, setUnavailable] = createSignal(false);
  const children = createMemo(() =>
    context.data.session.list().filter((session) =>
      session.parentID === props.sessionID && !session.time.archived,
    ),
  );
  const status = (session: ActivitySession) =>
    activityStatus(
      session,
      context.data.session.status(session.id),
      context.data.session.pending.list(session.id).length,
    );
  const rows = createMemo(() =>
    children()
      .filter((session) => isActive(status(session)) || tracked().has(session.id))
      .sort((left, right) =>
        Number(isActive(status(right))) - Number(isActive(status(left))) || right.time.updated - left.time.updated,
      ),
  );
  const inactive = () => rows().filter((session) => !isActive(status(session)));

  const noteStart = (ids: string[]) => {
    setTracked((previous) => {
      const next = new Set([...previous].filter((id) => {
        const session = context.data.session.get(id);
        // Another child can be created before the first child's hydration ends.
        return !session || isActive(status(session));
      }));
      for (const id of ids) next.add(id);
      return next;
    });
  };

  // Keep completions from the current delegation visible, but never restore
  // historical outcomes. A new delegation replaces finished rows, without timers.
  createEffect(() => {
    const active = children().filter((session) => isActive(status(session))).map((session) => session.id);
    const started = active.filter((id) => !previousActive.has(id));
    previousActive = new Set(active);
    if (started.length) noteStart(started);
  });

  const dismissInactive = () => {
    setTracked(new Set(rows().filter((session) => isActive(status(session))).map((session) => session.id)));
  };
  const navigate = (sessionID: string) => {
    if (disposed || !rows().some((session) => session.id === sessionID)) return;
    context.ui.router.navigate({ type: "session", sessionID });
  };

  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = context.client.session.list({ parentID: props.sessionID, order: "desc" })
      .then(async (response) => {
        await Promise.all(response.data.map(async (child) => {
          if (disposed) return;
          await context.data.session.sync(child.id);
          if (disposed) return;
          await context.data.session.pending.sync(child.id);
        }));
        if (!disposed) setUnavailable(false);
      })
      .catch(() => {
        if (!disposed) setUnavailable(true);
      })
      .finally(() => { refreshing = undefined; });
    return refreshing;
  };

  const openAll = async () => {
    if (unavailable()) await refresh();
    if (disposed || rows().length === 0) return;
    const selected = await context.ui.dialog.select({
      title: "Subagent activity",
      options: rows().map((session) => ({
        value: session.id,
        title: activityLabel(session),
        category: status(session),
      })),
      actions: inactive().length > 0
        ? [{
            bind: "ctrl+d",
            title: "Dismiss inactive",
            selection: "none",
            onTrigger: () => {
              if (disposed) return;
              dismissInactive();
              context.ui.dialog.clear();
            },
          }]
        : [],
    });
    if (selected) navigate(selected);
  };

  const stopCreated = context.data.on("session.created", (event) => {
    if (disposed || event.data.parentID !== props.sessionID) return;
    // Register creation before hydration: a very short run can already be done
    // by the time session.sync resolves, without ever rendering a running row.
    noteStart([event.data.sessionID]);
    void context.data.session.sync(event.data.sessionID).catch(() => {
      if (!disposed) setUnavailable(true);
    });
  });

  context.keymap.layer(() => ({
    commands: [{
      id: "background-subagent.open",
      title: "Open subagent activity",
      group: "Session",
      palette: true,
      slash: { name: "subagents" },
      enabled: () => rows().length > 0 || unavailable(),
      run: openAll,
    }],
  }));

  void refresh();
  onCleanup(() => {
    disposed = true;
    stopCreated();
  });

  const feedback = (state: ReturnType<typeof status>) => {
    if (state === "idle") return context.theme.text.muted;
    if (state === "failed") return context.theme.text.feedback.error.base;
    if (state === "done") return context.theme.text.feedback.success.base;
    if (state === "pending" || state === "stopped") return context.theme.text.feedback.warning.base;
    return context.theme.text.feedback.info.base;
  };

  return (
    <Show when={rows().length > 0 || unavailable()}>
      <box id="subagent-activity" width="100%" flexDirection="column" flexShrink={0}>
        <Show when={rows().length > 0}>
          <ActionLine context={context} id="subagent-activity-open" prominent onSelect={() => void openAll()}>
            <b>Subagents {rows().length}</b>  Open all
            {rows().length > MAX_VISIBLE_ROWS ? ` (+${rows().length - MAX_VISIBLE_ROWS})` : ""}
          </ActionLine>
          <For each={rows().slice(0, MAX_VISIBLE_ROWS)}>
            {(session) => (
              <ActionLine
                context={context}
                id={`subagent-activity-${session.id}`}
                onSelect={() => navigate(session.id)}
              >
                <b>
                  <span style={{ fg: feedback(status(session)) }}>
                    {STATUS_MARKERS[status(session)]} {status(session).padEnd(7)}
                  </span>  {oneLine(session.agent ?? "subagent")}
                </b>: {oneLine(session.title ?? "Delegated work")}
              </ActionLine>
            )}
          </For>
          <Show when={inactive().length > 0}>
            <ActionLine context={context} id="subagent-activity-dismiss" onSelect={dismissInactive}>
              Dismiss inactive
            </ActionLine>
          </Show>
        </Show>
        <Show when={unavailable()}>
          <ActionLine context={context} id="subagent-activity-retry" onSelect={() => void refresh()}>
            <span style={{ fg: context.theme.text.feedback.warning.base }}>Subagents unavailable; click to retry</span>
          </ActionLine>
        </Show>
      </box>
    </Show>
  );
}

export default Plugin.define({
  id: "background-subagent.tui",
  setup(context) {
    if (context.options.activityStrip === false) return;
    return context.ui.slot({
      append: "session.composer.top",
      render: (props) => (
        <Show when={props.sessionID} keyed>
          {(sessionID) => <ActivityStrip context={context} sessionID={sessionID} />}
        </Show>
      ),
    });
  },
});
