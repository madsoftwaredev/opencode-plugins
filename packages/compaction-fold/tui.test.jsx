/** @jsxImportSource @opentui/solid */

import { afterEach, expect, spyOn, test } from "bun:test";
import { Renderable, RGBA, SyntaxStyle } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { render } from "@opentui/solid";
import { createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import plugin from "./tui";

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const compact = (id = "compact", summary = "Generated checkpoint summary", status = "completed") =>
  ({ id, type: "compaction", summary, status });

async function mount({ options = {}, initial = [compact()], width = 80, supported = true } = {}) {
  const setup = await createTestRenderer({ width, height: 40 });
  cleanups.push(() => setup.dispose());
  const syntax = SyntaxStyle.fromStyles({}, setup.renderer.nativeScene);
  cleanups.push(async () => { await setup.renderer.idle(); syntax.destroy(); });
  const [messages, setMessages] = createStore({ a: initial, b: [compact("other", "Other session summary")] });
  const [session, setSession] = createSignal("a");
  const [enabled, setEnabled] = createSignal(true);
  const [rowsMounted, setRowsMounted] = createSignal(true);
  const records = new Map();
  const toasts = [];
  let claim;
  let unregister;
  const context = {
    options,
    renderer: setup.renderer,
    data: { session: { message: { list: (id) => messages[id] } } },
    theme: { text: { action: { secondary: { base: RGBA.fromHex("#b0b0b0") } } } },
    ui: {
      slot: (value) => { claim = value; return () => setEnabled(false); },
      toast: { show: (toast) => toasts.push(toast) },
    },
  };
  // This fixture mirrors the production CompactionMessage at 32b41ba. It keeps
  // real Solid ownership, OpenTUI layout, Markdown, frames, and mouse dispatch.
  function Compaction(props) {
    const record = {};
    records.set(`${session()}:${props.message.id}`, record);
    return (
      <box marginTop={1} flexShrink={0} ref={(node) => { record.row = node; }}>
        <box ref={(node) => { record.box = node; }}>
          <box flexDirection="row" alignItems="center">
            <box border={["top"]} flexGrow={1} />
            <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
              <Show when={props.message.status === "running"}><text>⋯</text></Show>
              <text>Compaction</text>
              <Show when={props.message.status === "completed"}><text>· 12 in · 3 out</text></Show>
            </box>
            <box border={["top"]} flexGrow={1} />
          </box>
          <Show when={props.message.summary.trim()}>
            <box paddingTop={1} paddingLeft={3} ref={(node) => { record.body = node; }}>
              <markdown
                ref={(node) => { record.markdown = node; }}
                syntaxStyle={syntax} streaming={true} internalBlockMode="top-level"
                content={props.message.summary.trim()} tableOptions={{ style: "grid", cellPaddingX: 1 }}
              />
            </box>
          </Show>
        </box>
      </box>
    );
  }
  await render(() => {
    unregister = plugin.setup(context);
    return (
      <Show when={session()} keyed>{(id) => (
        <box width="100%" height="100%" flexDirection="row">
          <box flexGrow={1} minHeight={0} paddingBottom={supported ? 1 : 0}>
            <box height={1} id="chat-title.header"><text>Session title</text></box>
            <box flexGrow={1} minHeight={0} position="relative">
              <scrollbox flexGrow={1} stickyScroll={false}>
                <box marginTop={1} flexShrink={0}><text>Earlier user conversation</text></box>
                <box marginTop={1} flexShrink={0}>
                  <markdown syntaxStyle={syntax} streaming={true} internalBlockMode="top-level" content="Generated checkpoint summary" />
                </box>
                <Show when={rowsMounted()}>
                  <For each={messages[id]}>{(message) => <Compaction message={message} />}</For>
                </Show>
                <box marginTop={1} flexShrink={0}><text>Later assistant conversation</text></box>
              </scrollbox>
            </box>
            <box height={1} flexShrink={0} />
            <box flexShrink={0}>
              <Show when={enabled()}>{claim.render({ sessionID: id })}</Show>
              <text>Composer</text>
            </box>
          </box>
        </box>
      )}</Show>
    );
  }, setup.renderer);
  cleanups.push(() => unregister());
  await setup.renderOnce();
  return {
    ...setup, toasts, unregister, setMessages, setSession, setRowsMounted,
    record: (id = "compact") => records.get(`${session()}:${id}`),
    control: (id = "compact") => records.get(`${session()}:${id}`).box.getChildren()
      .find((node) => node.id === "compaction-fold.control"),
    async click(id = "compact", button = 0) {
      const node = this.control(id);
      await setup.mockMouse.click(node.x + 4, node.y, button, { delayMs: 0 });
      await setup.renderOnce();
    },
  };
}

test("folds only the summary, preserves metadata and chat, and toggles with real mouse input", async () => {
  const view = await mount();
  const original = view.record().markdown;
  expect(view.toasts).toEqual([]);
  expect(view.record().body.visible).toBe(false);
  let frame = view.captureCharFrame();
  expect(frame).toContain("▶ Compaction summary");
  expect(frame).toContain("12 in · 3 out");
  expect(frame).toContain("Earlier user conversation");
  expect(frame).toContain("Later assistant conversation");
  // The ordinary assistant Markdown with identical text remains visible.
  expect(frame.match(/Generated checkpoint summary/g)).toHaveLength(1);
  await view.click();
  expect(view.record().body.visible).toBe(true);
  expect(view.record().markdown).toBe(original);
  expect(view.captureCharFrame().match(/Generated checkpoint summary/g)).toHaveLength(2);
  await view.click();
  expect(view.record().body.visible).toBe(false);
  await view.click("compact", 2);
  expect(view.record().body.visible).toBe(false);
});

test("defaultExpanded starts open and each summary toggles independently", async () => {
  const view = await mount({ options: { defaultExpanded: true }, initial: [compact(), compact("second", "Second summary")] });
  expect(view.record().body.visible).toBe(true);
  expect(view.record("second").body.visible).toBe(true);
  await view.click();
  expect(view.record().body.visible).toBe(false);
  expect(view.record("second").body.visible).toBe(true);
});

test("arriving and streaming summaries fold on renderer frames without recreating Markdown", async () => {
  const view = await mount({ initial: [] });
  view.setMessages("a", [compact("compact", "", "running")]);
  await view.renderOnce();
  expect(view.control()).toBeUndefined();
  view.setMessages("a", 0, "summary", "Streaming summary");
  await view.renderOnce();
  expect(view.record().body.visible).toBe(false);
  await view.click();
  const markdown = view.record().markdown;
  view.setMessages("a", 0, "summary", "Streaming summary grows");
  view.setMessages("a", 0, "status", "completed");
  await view.renderOnce();
  expect(view.record().markdown).toBe(markdown);
  expect(view.record().body.visible).toBe(true);
  expect(view.captureCharFrame()).toContain("Streaming summary grows");
  expect(view.record().box.getChildren()).toHaveLength(3);
});

test("remounted history keeps its toggle but switching sessions resets view-local choices", async () => {
  const view = await mount();
  await view.click();
  const old = view.record();
  view.setRowsMounted(false);
  await view.renderOnce();
  expect(old.row.parent).toBeNull();
  view.setRowsMounted(true);
  await view.renderOnce();
  expect(view.record().body.visible).toBe(true);
  expect(view.record().markdown).not.toBe(old.markdown);
  view.setSession("b");
  await view.renderOnce();
  expect(view.record("other").body.visible).toBe(false);
  view.setSession("a");
  await view.renderOnce();
  expect(view.record().body.visible).toBe(false);
});

test("cleanup restores the original body and removes controls and the frame callback", async () => {
  const view = await mount();
  const record = view.record();
  const control = view.control();
  const remove = spyOn(view.renderer, "removeFrameCallback");
  cleanups.push(() => remove.mockRestore());
  view.unregister();
  await view.renderOnce();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(record.body.visible).toBe(true);
  expect(record.markdown.isDestroyed).toBe(false);
  expect(control.isDestroyed).toBe(true);
  expect(record.box.getChildren()).toHaveLength(2);
  view.setMessages("a", 0, "summary", "Still visible after unload");
  await view.renderOnce();
  expect(view.captureCharFrame()).toContain("Still visible after unload");
  expect(view.control()).toBeUndefined();
});

test("typed non-compactions, failures, empty summaries, and duplicate summaries fail open", async () => {
  const view = await mount({ initial: [
    { ...compact("assistant", "Ordinary assistant text"), type: "assistant" },
    compact("failed", "Compaction error", "failed"), compact("empty", ""),
    compact("one", "Same summary"), compact("two", "Same summary"),
  ] });
  for (const id of ["assistant", "failed", "one", "two"]) {
    expect(view.control(id)).toBeUndefined();
    expect(view.record(id).body.visible).toBe(true);
  }
  expect(view.control("empty")).toBeUndefined();
});

test("a recycled row or a changed host shape is immediately restored, not misidentified", async () => {
  const view = await mount();
  const row = view.record().row;
  view.setMessages("a", 0, "type", "assistant");
  await view.renderOnce();
  expect(view.record().row).toBe(row);
  expect(view.record().body.visible).toBe(true);
  expect(view.control()).toBeUndefined();
  view.setMessages("a", 0, "type", "compaction");
  await view.renderOnce();
  expect(view.record().body.visible).toBe(false);
  view.record().body.paddingLeft = 4;
  await view.renderOnce();
  expect(view.record().body.visible).toBe(true);
  expect(view.control()).toBeUndefined();
});

test("unsupported session layouts warn once and do not fold anything", async () => {
  const view = await mount({ supported: false });
  await view.renderOnce();
  expect(view.record().body.visible).toBe(true);
  expect(view.control()).toBeUndefined();
  expect(view.toasts).toHaveLength(1);
});

test("layout discovery errors warn once without crashing the composer slot", async () => {
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  const padding = spyOn(Renderable.prototype, "getPadding").mockImplementationOnce(() => {
    throw new Error("Changed host layout API");
  });
  cleanups.push(() => { warning.mockRestore(); padding.mockRestore(); });
  const view = await mount();
  await view.renderOnce();
  expect(view.record().body.visible).toBe(true);
  expect(view.control()).toBeUndefined();
  expect(view.captureCharFrame()).toContain("Composer");
  expect(warning).toHaveBeenCalledTimes(1);
  expect(view.toasts).toHaveLength(1);
});

test("failure transitions and unknown headings restore the body rather than hide errors", async () => {
  const view = await mount({ initial: [compact("compact", "Partial summary", "running")] });
  expect(view.record().body.visible).toBe(false);
  view.setMessages("a", 0, "status", "failed");
  view.setMessages("a", 0, "summary", "Provider request failed");
  await view.renderOnce();
  expect(view.record().body.visible).toBe(true);
  expect(view.captureCharFrame()).toContain("Provider request failed");
  view.setMessages("a", 0, "status", "completed");
  await view.renderOnce();
  expect(view.record().body.visible).toBe(false);
  const heading = view.record().box.getChildren()[0].getChildren()[1];
  heading.getChildren().find((node) => node.plainText === "Compaction").content = "New host heading";
  await view.renderOnce();
  expect(view.record().body.visible).toBe(true);
  expect(view.control()).toBeUndefined();
});

test("provider-compaction headings work and a removed control is safely replaced", async () => {
  const view = await mount();
  const heading = view.record().box.getChildren()[0].getChildren()[1];
  heading.getChildren().find((node) => node.plainText === "Compaction").content = "Provider compaction";
  view.control().destroy();
  await view.renderOnce();
  expect(view.record().body.visible).toBe(false);
  expect(view.control()).toBeDefined();
  await view.click();
  expect(view.record().body.visible).toBe(true);
});

test("unexpected tree errors restore summaries and stop the adapter with one diagnostic", async () => {
  const view = await mount();
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  const remove = spyOn(view.renderer, "removeFrameCallback");
  const children = spyOn(view.record().row, "getChildren").mockImplementationOnce(() => {
    throw new Error("Changed host render tree");
  });
  cleanups.push(() => { warning.mockRestore(); remove.mockRestore(); children.mockRestore(); });
  await view.renderOnce();
  expect(view.record().body.visible).toBe(true);
  expect(view.control()).toBeUndefined();
  expect(remove).toHaveBeenCalledTimes(1);
  expect(warning).toHaveBeenCalledTimes(1);
  expect(view.toasts).toHaveLength(1);
  await view.renderOnce();
  expect(view.toasts).toHaveLength(1);
});

test("the inline row fits a narrow terminal without covering the composer", async () => {
  const view = await mount({ width: 24 });
  expect(view.captureCharFrame()).toContain("▶ Compaction summary");
  expect(view.captureCharFrame()).toContain("Composer");
  await view.click();
  expect(view.record().body.visible).toBe(true);
  expect(view.captureCharFrame()).toContain("Composer");
});
