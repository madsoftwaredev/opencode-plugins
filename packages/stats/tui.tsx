/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { Show, createEffect, createSignal, onCleanup, untrack } from "solid-js"
import {
  countStats,
  effectiveSettings,
  formatStats,
  latestSpeed,
  loadSummaries,
  messagePageInput,
  readSettings,
  type Stat,
  type StatSettings,
  type Summary,
} from "./stats"

function StatsStatus(props: { context: Context; sessionID?: string; settings: () => StatSettings }) {
  const { context } = props
  const [snapshot, setSnapshot] = createSignal<{ sessionID: string; messages: Summary[] }>()

  createEffect(() => {
    const sessionID = props.sessionID
    const settings = props.settings()
    const needCounts = settings.turns || settings.steps
    if (untrack(snapshot)?.sessionID !== sessionID) setSnapshot(undefined)
    if (!sessionID || (!settings.speed && !needCounts)) return

    const controller = new AbortController()
    let messages = untrack(snapshot)?.messages
    let running = false
    let pending = false

    const refreshCounts = async () => {
      if (!needCounts) return
      if (running) {
        pending = true
        return
      }

      running = true
      do {
        pending = false
        try {
          messages = await loadSummaries(
            (cursor) => context.client.message.list(
              messagePageInput(sessionID, cursor),
              { signal: controller.signal },
            ),
            messages,
          )
          if (!controller.signal.aborted) setSnapshot({ sessionID, messages })
        } catch (error) {
          if (!controller.signal.aborted) console.warn("[opencode-stats] Could not load session counts", error)
        }
      } while (pending && !controller.signal.aborted)
      running = false
    }

    const refresh = () => {
      void refreshCounts()
      if (settings.speed) {
        void context.data.session.message.sync(sessionID).catch((error: unknown) => {
          if (!controller.signal.aborted) console.warn("[opencode-stats] Could not refresh session messages", error)
        })
      }
    }

    refresh()
    const stopStarted = context.data.on("session.execution.started", (event) => {
      if (event.data.sessionID === sessionID) refresh()
    })
    const stopStepStarted = context.data.on("session.step.started", (event) => {
      if (event.data.sessionID === sessionID) refresh()
    })
    const stopUsage = context.data.on("session.usage.updated", (event) => {
      if (event.data.sessionID === sessionID) refresh()
    })
    const stopStepEnded = context.data.on("session.step.ended", (event) => {
      if (event.data.sessionID === sessionID) refresh()
    })

    onCleanup(() => {
      controller.abort()
      stopStarted()
      stopStepStarted()
      stopUsage()
      stopStepEnded()
    })
  })

  const label = () => {
    if (!props.sessionID) return ""
    const settings = props.settings()
    const saved = snapshot()
    const counts = saved?.sessionID === props.sessionID ? countStats(saved.messages) : undefined
    const speed = settings.speed
      ? latestSpeed(
          context.data.session.message.list(props.sessionID),
          context.data.session.get(props.sessionID)?.model,
        )
      : undefined
    return formatStats(settings, counts, speed)
  }

  return (
    <Show when={label()}>
      {(value) => <text fg={context.theme.text.muted} wrapMode="none">{value()}</text>}
    </Show>
  )
}

export default Plugin.define({
  id: "opencode-stats",
  setup(context) {
    const defaults = readSettings(context.options)
    const [state, update] = context.storage.store<{ overrides: Partial<StatSettings> }>("settings", {
      initial: { overrides: {} },
    })
    const settings = () => effectiveSettings(defaults, state.overrides ?? {})

    const configure = async () => {
      const current = settings()
      const options: { title: string; value: Stat | "reset"; description: string }[] = [
        { title: `Token speed: ${current.speed ? "On" : "Off"}`, value: "speed", description: "Tokens per second in the prompt footer" },
        { title: `Total turns: ${current.turns ? "On" : "Off"}`, value: "turns", description: "Execution turns in this session" },
        { title: `Total steps: ${current.steps ? "On" : "Off"}`, value: "steps", description: "Assistant steps in this session" },
        { title: "Reset to configured defaults", value: "reset", description: "Use the options from cli.json" },
      ]
      const choice = await context.ui.dialog.select({ title: "Footer stats", options })
      if (!choice) return

      try {
        await update((draft) => {
          if (choice === "reset") draft.overrides = {}
          else draft.overrides[choice] = !(draft.overrides[choice] ?? defaults[choice])
        })
      } catch (error) {
        console.warn("[opencode-stats] Could not save settings", error)
        context.ui.toast.show({ title: "Footer stats", message: "Could not save settings", variant: "error" })
      }
    }

    const unregisterStatus = context.ui.slot({
      append: "prompt.footer.status",
      render: ({ sessionID }) => <StatsStatus context={context} sessionID={sessionID} settings={settings} />,
    })
    const unregisterCommand = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "opencode-stats.configure",
            title: "Configure footer stats",
            group: "Appearance",
            palette: true,
            slash: { name: "stats" },
            run: configure,
          }],
          bindings: ["opencode-stats.configure"],
        }))
        return null
      },
    })

    return () => {
      unregisterStatus()
      unregisterCommand()
    }
  },
})
