/** @jsxImportSource @opentui/solid */

import { afterEach, expect, spyOn, test } from "bun:test"
import { Renderable, RGBA } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { fitTitle } from "./title"
import plugin from "./tui"

const cleanups = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function mount({ width = 80, supported = true } = {}) {
  const setup = await createTestRenderer({ width, height: 24 })
  cleanups.push(() => setup.dispose())
  const [session, setSession] = createStore({ title: "Current chat title" })
  const [settings, setSettings] = createStore({ enabled: true })
  const [sidebar, setSidebar] = createSignal(false)
  const [alive, setAlive] = createSignal(true)
  const slots = new Map()
  const toasts = []
  let command
  let column
  let unregister
  const context = {
    renderer: setup.renderer,
    storage: { store: () => [settings, async (mutation) => setSettings(produce(mutation))] },
    data: { session: { get: () => session } },
    theme: { text: { base: RGBA.fromHex("#ffffff") } },
    keymap: { layer: (factory) => { command = factory().commands[0] } },
    ui: {
      slot: (claim) => { slots.set(claim.append, claim); return () => setAlive(false) },
      toast: { show: (toast) => toasts.push(toast) },
    },
  }
  await render(() => {
    unregister = plugin.setup(context)
    return (
      <box width="100%" height="100%" flexDirection="row">
        <box flexGrow={1} minHeight={0} paddingBottom={supported ? 1 : 0} ref={(node) => { column = node }}>
          <box flexGrow={1} minHeight={0}>
            <scrollbox flexGrow={1}><text>Conversation</text></scrollbox>
          </box>
          <box height={1} flexShrink={0} />
          <box flexShrink={0}>
            <Show when={alive()}>{slots.get("session.composer.top").render({ sessionID: "session" })}</Show>
            <text>Composer</text>
          </box>
        </box>
        <Show when={alive() && sidebar()}>
          <box width={20}>{slots.get("sidebar.content").render({ sessionID: "session" })}</box>
        </Show>
      </box>
    )
  }, setup.renderer)
  cleanups.push(() => unregister())
  await setup.renderOnce()
  await setup.renderOnce()
  return {
    ...setup, toasts, settings, command, unregister, setSidebar,
    setTitle: (title) => setSession("title", title),
    header: () => column.getChildren().find((node) => node.id === "chat-title.header"),
    column,
  }
}

test("the real 0.6 renderer displays, updates, and refits the header without covering chat", async () => {
  const view = await mount()
  expect(view.toasts).toEqual([])
  expect(view.captureCharFrame()).toContain("Current chat title")
  const title = "A much longer title that must fit a narrow terminal"
  view.setTitle(title)
  await view.renderOnce()
  expect(view.captureCharFrame()).toContain(title)
  view.renderer.resize(24, 24)
  await view.renderOnce()
  await view.renderOnce()
  expect(view.header().getChildren()[0].plainText).toBe(fitTitle(title, 20))
  const frame = view.captureCharFrame()
  expect(frame).toContain("Conversation")
  expect(frame).toContain("Composer")
  expect(view.header().height).toBe(1)
  expect(view.header().y).toBeLessThan(view.column.getChildren()[1].y)
})

test("sidebar visibility, saved toggles, and unload remove and restore only the header", async () => {
  const view = await mount()
  view.setSidebar(true)
  await view.renderOnce()
  expect(view.header()).toBeUndefined()
  view.setSidebar(false)
  await view.renderOnce()
  expect(view.header()).toBeDefined()
  await view.command.run()
  await view.renderOnce()
  expect(view.settings.enabled).toBe(false)
  expect(view.header()).toBeUndefined()
  await view.command.run()
  await view.renderOnce()
  expect(view.settings.enabled).toBe(true)
  const header = view.header()
  const label = header.getChildren()[0]
  view.unregister()
  await view.renderOnce()
  expect(header.isDestroyed).toBe(true)
  expect(label.isDestroyed).toBe(true)
  expect(view.column.getChildren()).toHaveLength(3)
  expect(view.captureCharFrame()).toContain("Conversation")
  expect(view.captureCharFrame()).toContain("Composer")
})

test("unsupported layouts leave the transcript and composer intact with one warning", async () => {
  const view = await mount({ supported: false })
  expect(view.header()).toBeUndefined()
  expect(view.toasts).toHaveLength(1)
  expect(view.captureCharFrame()).toContain("Conversation")
  expect(view.captureCharFrame()).toContain("Composer")
})

test("layout discovery exceptions warn instead of crashing the composer slot", async () => {
  const warning = spyOn(console, "warn").mockImplementation(() => {})
  const height = spyOn(Renderable.prototype, "getHeight").mockImplementationOnce(() => {
    throw new Error("Changed host layout API")
  })
  cleanups.push(() => { warning.mockRestore(); height.mockRestore() })
  const view = await mount()
  expect(view.header()).toBeUndefined()
  expect(view.toasts).toHaveLength(1)
  expect(warning).toHaveBeenCalledTimes(1)
  expect(view.captureCharFrame()).toContain("Composer")
})
