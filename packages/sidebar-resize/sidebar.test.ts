import { afterEach, expect, test } from "bun:test";
import { BoxRenderable, ScrollBoxRenderable, TextRenderable, Yoga } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { attachSidebarResize } from "./sidebar";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

// Structural fixture, not a running OpenCode host. Sidebar children/padding and
// pane width follow packages/tui/src/routes/session/sidebar.tsx and
// packages/tui/src/component/session-frame.tsx at 32b41bab (2.1.0-era checkout).
async function fixture(overlay = false, beforeLayout = false) {
  const setup = await createTestRenderer({ width: 180, height: 30 });
  const { renderer } = setup;
  cleanups.push(() => renderer.destroy());
  const row = new BoxRenderable(renderer, { width: "100%", height: "100%", flexDirection: "row" });
  const tabs = new BoxRenderable(renderer, { width: overlay ? 0 : 32, flexShrink: 0 });
  const session = new BoxRenderable(renderer, {
    flexGrow: 1,
    minWidth: 0,
    height: "100%",
    flexDirection: "row",
  });
  const transcript = new BoxRenderable(renderer, { flexGrow: 1, minWidth: 0 });
  const pane = new BoxRenderable(
    renderer,
    overlay
      ? { position: "absolute", width: "100%", height: "100%", alignItems: "flex-end" }
      : { width: 42, height: "100%", flexShrink: 0 }
  );
  const sidebar = new BoxRenderable(renderer, {
    width: 42,
    height: "100%",
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    paddingBottom: 1,
  });
  const heading = new BoxRenderable(renderer, { height: 2 });
  heading.add(new TextRenderable(renderer, { content: "Session title" }));
  const content = new ScrollBoxRenderable(renderer, { flexGrow: 1, minHeight: 0 });
  const section = new TextRenderable(renderer, { content: "CONTEXT · MCP · SUBAGENTS · USAGE" });
  content.add(section);
  const footer = new BoxRenderable(renderer, { height: 2 });
  const anchor = new BoxRenderable(renderer, { visible: false, width: 0, height: 0 });
  footer.add(anchor);
  sidebar.add(heading);
  sidebar.add(content);
  sidebar.add(footer);
  pane.add(sidebar);
  row.add(tabs);
  row.add(session);
  session.add(transcript);
  session.add(pane);
  renderer.root.add(row);
  if (!beforeLayout) await setup.renderOnce();
  let preference = 60;
  const saved: number[] = [];
  const attachment = attachSidebarResize({
    core: { BoxRenderable, ScrollBoxRenderable, Yoga },
    anchor,
    renderer,
    width: () => preference,
    save: (width) => {
      saved.push(width);
      preference = width;
    },
    highlight: () => sidebar.backgroundColor,
  });
  if (!attachment) throw new Error("Expected inspected sidebar shape to attach");
  cleanups.push(attachment.dispose);
  await setup.renderOnce();
  return {
    ...setup,
    pane,
    sidebar,
    transcript,
    content,
    section,
    anchor,
    saved,
    attachment,
    setWidth: (width: number) => {
      preference = width;
      attachment.refresh();
    },
  };
}

test("attaches before the first layout using OpenTUI 0.6.6 style getters", async () => {
  const view = await fixture(false, true);
  expect("getLayoutNode" in view.sidebar).toBe(false);
  expect(view.sidebar.getWidth()).toEqual({ unit: Yoga.Unit.Point, value: 60 });
  expect(view.pane.getWidth()).toEqual({ unit: Yoga.Unit.Point, value: 60 });
  expect(view.sidebar.width).toBe(60);
  expect(view.pane.width).toBe(60);
  expect(view.transcript.width).toBe(88);
});

test("resizes the entire existing sidebar and its host pane without replacing sections", async () => {
  const view = await fixture();
  expect(view.sidebar.width).toBe(60);
  expect(view.pane.width).toBe(60);
  expect(view.transcript.width).toBe(88);
  expect(view.section.parent).toBe(view.content.content);
  view.setWidth(72);
  await view.renderOnce();
  expect(view.sidebar.width).toBe(72);
  expect(view.pane.width).toBe(72);
  expect(view.transcript.width).toBe(76);
});

test("dragging either cell of the left edge resizes live and persists once on release", async () => {
  const view = await fixture();
  const edge = view.sidebar.x;
  await view.mockMouse.drag(edge + 1, 3, edge - 11, 3, 0, { delayMs: 0 });
  await view.renderOnce();
  expect(view.sidebar.width).toBe(72);
  expect(view.pane.width).toBe(72);
  expect(view.saved).toEqual([72]);
});

test("other mouse buttons and content drags do not resize", async () => {
  const view = await fixture();
  await view.mockMouse.drag(view.sidebar.x, 3, view.sidebar.x - 8, 3, 2, { delayMs: 0 });
  await view.mockMouse.drag(view.sidebar.x + 10, 3, view.sidebar.x + 20, 3, 0, { delayMs: 0 });
  await view.renderOnce();
  expect(view.saved).toEqual([]);
  expect(view.sidebar.width).toBe(60);
});

test("terminal resize clamps temporarily and restores the saved preference when space returns", async () => {
  const view = await fixture();
  view.resize(140, 30);
  await view.renderOnce();
  await view.renderOnce();
  expect(view.sidebar.width).toBe(44);
  expect(view.transcript.width).toBe(64);
  view.resize(180, 30);
  await view.renderOnce();
  await view.renderOnce();
  expect(view.sidebar.width).toBe(60);
  expect(view.saved).toEqual([]);
});

test("narrow overlay keeps its full-screen host and resizes only the sidebar", async () => {
  const view = await fixture(true);
  expect(view.pane.width).toBe(180);
  expect(view.sidebar.width).toBe(60);
  view.resize(50, 30);
  await view.renderOnce();
  await view.renderOnce();
  expect(view.pane.width).toBe(50);
  expect(view.sidebar.width).toBe(48);
});

test("unload removes the handle and restores host widths; unknown trees remain untouched", async () => {
  const view = await fixture();
  view.attachment.dispose();
  await view.renderOnce();
  expect(view.sidebar.width).toBe(42);
  expect(view.pane.width).toBe(42);
  expect(view.sidebar.getChildren()).toHaveLength(3);
  view.sidebar.width = 55;
  const result = attachSidebarResize({
    core: { BoxRenderable, ScrollBoxRenderable, Yoga },
    anchor: view.anchor,
    renderer: view.renderer,
    width: () => 70,
    save: () => {},
    highlight: () => view.sidebar.backgroundColor,
  });
  expect(result).toBeUndefined();
  await view.renderOnce();
  expect(view.sidebar.width).toBe(55);
});
