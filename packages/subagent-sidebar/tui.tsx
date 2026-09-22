/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import {
  descendantSessions,
  shorten,
  subagentStatus,
  subagentTask,
  type SubagentSession,
  type SubagentStatus,
} from "./subagent-view"

const MAX_VISIBLE_SUBAGENTS = 8
const MAX_EXPANDED_HEIGHT = 16

const STATUS_MARKERS: Record<SubagentStatus, string> = {
  running: "●",
  idle: "○",
  done: "✓",
  failed: "×",
  stopped: "!",
}

const STATUS_LABELS: Record<SubagentStatus, string> = {
  running: "running",
  idle: "idle",
  done: "done",
  failed: "failed",
  stopped: "stopped",
}

type SyncState = {
  children: Set<string>
  messages: Set<string>
}

function sessionLabel(session: SubagentSession): string {
  return shorten(session.agent ?? session.title ?? "subagent", 24)
}

function isPrimaryMouseButton(event: { button: number }): boolean {
  return event.button === 0
}

function openSubagent(context: Context, sessionID: string, event: { button: number }): void {
  if (!isPrimaryMouseButton(event)) return
  context.ui.router.navigate({ type: "session", sessionID })
}

function SubagentRow(props: { context: Context; session: SubagentSession }) {
  const [hovered, setHovered] = createSignal(false)
  const session = () => props.context.data.session.get(props.session.id) ?? props.session
  const activity = () => props.context.data.session.status(props.session.id)
  const status = () => subagentStatus(session(), activity())
  const messages = () => props.context.data.session.message.list(props.session.id)

  return (
    <box
      flexDirection="column"
      width="100%"
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={(event) => openSubagent(props.context, props.session.id, event)}
    >
      <text fg={props.context.theme.text.base} wrapMode="none">
        {STATUS_MARKERS[status()]} {sessionLabel(session())} · {STATUS_LABELS[status()]}
      </text>
      <text
        fg={hovered() ? props.context.theme.text.base : props.context.theme.text.muted}
        wrapMode="none"
      >
        {shorten(subagentTask(messages(), activity()), 48)}
      </text>
    </box>
  )
}

function SidebarSubagents(props: { context: Context; sessionID: string; syncState: SyncState }) {
  const { context } = props
  const [expanded, setExpanded] = createSignal(false)
  const [moreHovered, setMoreHovered] = createSignal(false)
  const [collapseHovered, setCollapseHovered] = createSignal(false)
  const sessions = createMemo(() =>
    descendantSessions(context.data.session.list(), props.sessionID),
  )
  const displayedSessions = createMemo(() =>
    expanded() ? sessions() : sessions().slice(0, MAX_VISIBLE_SUBAGENTS),
  )

  createEffect(() => {
    sessions()
    syncChildren(context, props.sessionID, props.syncState)
  })

  createEffect(() => {
    for (const session of displayedSessions()) {
      syncMessages(context, session.id, props.syncState)
    }
  })

  const expand = (event: { button: number }) => {
    if (isPrimaryMouseButton(event)) setExpanded(true)
  }

  const collapse = (event: { button: number }) => {
    if (isPrimaryMouseButton(event)) setExpanded(false)
  }

  return (
    <Show when={sessions().length > 0}>
      <box flexDirection="column" paddingBottom={1}>
        <text fg={context.theme.text.base} wrapMode="none">
          SUBAGENTS ({sessions().length})
        </text>
        <Show
          when={expanded()}
          fallback={
            <box flexDirection="column">
              <For each={displayedSessions()}>
                {(session) => <SubagentRow context={context} session={session} />}
              </For>
              <Show when={sessions().length > MAX_VISIBLE_SUBAGENTS}>
                <box
                  width="100%"
                  backgroundColor={
                    moreHovered()
                      ? context.theme.background.raised.base
                      : context.theme.background.base
                  }
                  onMouseOver={() => setMoreHovered(true)}
                  onMouseOut={() => setMoreHovered(false)}
                  onMouseDown={expand}
                >
                  <text
                    fg={moreHovered() ? context.theme.text.base : context.theme.text.muted}
                    wrapMode="none"
                  >
                    +{sessions().length - MAX_VISIBLE_SUBAGENTS} more
                  </text>
                </box>
              </Show>
            </box>
          }
        >
          <scrollbox
            width="100%"
            height={Math.min(MAX_EXPANDED_HEIGHT, Math.max(2, sessions().length * 2))}
            scrollY={true}
          >
            <box flexDirection="column" width="100%" minWidth={0}>
              <For each={sessions()}>
                {(session) => <SubagentRow context={context} session={session} />}
              </For>
            </box>
          </scrollbox>
          <box
            border={true}
            borderColor={context.theme.text.muted}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={
              collapseHovered()
                ? context.theme.background.raised.base
                : context.theme.background.base
            }
            onMouseOver={() => setCollapseHovered(true)}
            onMouseOut={() => setCollapseHovered(false)}
            onMouseDown={collapse}
          >
            <text
              fg={collapseHovered() ? context.theme.text.base : context.theme.text.muted}
              wrapMode="none"
            >
              Collapse subagents
            </text>
          </box>
        </Show>
      </box>
    </Show>
  )
}

function syncMessages(context: Context, sessionID: string, state: SyncState): void {
  if (state.messages.has(sessionID)) return
  state.messages.add(sessionID)
  void context.data.session.message.sync(sessionID).catch(() => state.messages.delete(sessionID))
}

function syncChildren(context: Context, sessionID: string, state: SyncState): void {
  if (state.children.has(sessionID)) return
  state.children.add(sessionID)

  void context.client.session
    .list({ parentID: sessionID, order: "desc" })
    .then((response) =>
      Promise.all(
        response.data.map(async (child) => {
          await context.data.session.sync(child.id)
          syncChildren(context, child.id, state)
        }),
      ),
    )
    .catch(() => state.children.delete(sessionID))
}

export default Plugin.define({
  id: "local.subagent-sidebar",
  setup(context) {
    let disposed = false
    const syncState: SyncState = {
      children: new Set(),
      messages: new Set(),
    }

    const syncParent = (sessionID: string | undefined) => {
      if (!sessionID || disposed) return
      syncChildren(context, sessionID, syncState)
    }

    const stopCreated = context.data.on("session.created", (event) => {
      syncParent(event.data.parentID)
    })

    const stopStatus = context.data.on("session.status", (event) => {
      syncParent(event.data.sessionID)
    })

    const unregister = context.ui.slot({
      prepend: "sidebar.content",
      render: ({ sessionID }) => (
        <SidebarSubagents context={context} sessionID={sessionID} syncState={syncState} />
      ),
    })

    return () => {
      disposed = true
      stopCreated()
      stopStatus()
      unregister()
    }
  },
})
