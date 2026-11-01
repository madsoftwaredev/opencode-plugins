/** @jsxImportSource @opentui/solid */

import { afterEach, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { render } from "@opentui/solid";
import { For, Show, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import plugin from "./tui";

const cleanups = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function child(id, patch = {}) {
  return {
    id,
    parentID: "parent",
    agent: "explore",
    title: "Map the plugin call path",
    time: { created: 1, updated: 1 },
    ...patch,
  };
}

const color = (hex) => RGBA.fromHex(hex);
const theme = {
  text: {
    base: color("#f2f2f2"),
    muted: color("#aaaaaa"),
    action: {
      primary: { base: color("#101828"), hovered: color("#101828") },
      secondary: { base: color("#f2f2f2"), hovered: color("#ffffff") },
    },
    feedback: {
      info: { base: color("#98c8ff") },
      success: { base: color("#9be2b0") },
      warning: { base: color("#f4cd86") },
      error: { base: color("#ffacac") },
    },
  },
  background: {
    raised: { base: color("#202735") },
    action: {
      primary: { base: color("#98c8ff"), hovered: color("#c1ddff") },
      secondary: { base: color("#202735"), hovered: color("#3b485c") },
    },
  },
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Render the inspected native Dialog mouse contract, not a select-call counter:
// packages/tui/src/ui/dialog.tsx (backdrop release, selection-dismiss flag, body
// propagation) and dialog-select.tsx (option release). The actual host components
// require its app/config/theme/keymap providers, which this standalone package
// does not depend on. Keep real OpenTUI hit testing and selection in this fixture.
function ReleaseDismissDialog(props) {
  let dismiss = false;
  return (
    <box
      id="picker-backdrop"
      position="absolute"
      left={0}
      top={0}
      zIndex={3000}
      width="100%"
      height="100%"
      alignItems="center"
      paddingTop={4}
      backgroundColor="#101010"
      onMouseDown={() => { dismiss = !!props.renderer.getSelection(); }}
      onMouseUp={() => {
        if (dismiss) {
          dismiss = false;
          return;
        }
        props.close();
      }}
    >
      <box
        id="picker-body"
        width={60}
        maxWidth="100%"
        padding={1}
        backgroundColor="#303030"
        onMouseUp={(event) => {
          if (props.renderer.getSelection()?.getSelectedText()) return;
          dismiss = false;
          event.stopPropagation();
        }}
      >
        <text>{props.input.title}</text>
        <For each={props.input.options}>
          {(option) => (
            <box id={`picker-${option.value}`} height={1} onMouseUp={() => props.close(option.value)}>
              <text>{option.title}</text>
            </box>
          )}
        </For>
      </box>
    </box>
  );
}

async function mount({ sessions = [], active = {}, pending = {}, width = 90, options = {}, list, sync, renderDialog = false } = {}) {
  const setup = await createTestRenderer({ width, height: 18 });
  cleanups.push(() => setup.renderer.destroy());
  const [state, setState] = createStore({ sessions, active, pending });
  const [enabled, setEnabled] = createSignal(true);
  const [sessionID, setSessionID] = createSignal("parent");
  const [picker, setPicker] = createSignal();
  const closePicker = (value) => {
    const current = picker();
    setPicker(undefined);
    current?.resolve(value);
  };
  const listeners = new Map();
  const navigations = [];
  const selections = [];
  const syncs = [];
  const listCalls = [];
  const commands = [];
  const selection = deferred();
  let contribution;
  let unregister;
  const context = {
    options,
    theme,
    renderer: setup.renderer,
    client: { session: { list: async (input) => {
      listCalls.push(input);
      return list ? list(input) : { data: sessions.filter((session) => session.parentID === input.parentID) };
    } } },
    data: {
      on: (name, listener) => {
        const group = listeners.get(name) ?? new Set();
        group.add(listener);
        listeners.set(name, group);
        return () => group.delete(listener);
      },
      session: {
        list: () => state.sessions,
        get: (id) => state.sessions.find((session) => session.id === id),
        status: (id) => state.active[id] ?? "idle",
        sync: async (id) => {
          syncs.push(id);
          await sync?.(id, setState);
        },
        pending: {
          list: (id) => state.pending[id] ?? [],
          sync: async () => {},
        },
      },
    },
    keymap: { layer: (factory) => commands.push(factory) },
    ui: {
      slot: (claim) => {
        contribution = claim;
        return () => setEnabled(false);
      },
      router: { navigate: (route) => navigations.push(route) },
      dialog: {
        select: (input) => {
          selections.push(input);
          if (renderDialog) return new Promise((resolve) => setPicker({ input, resolve }));
          return selection.promise;
        },
        clear: () => renderDialog ? closePicker() : selection.resolve(undefined),
      },
    },
  };
  await render(() => {
    unregister = plugin.setup(context);
    return (
      <box width="100%" height="100%" flexDirection="column">
        <text>+ 4 commands, 6 reads, 4 tools</text>
        <text>Existing goal contribution</text>
        <Show when={enabled() && contribution}>{contribution.render({ get sessionID() { return sessionID(); } })}</Show>
        <text id="prompt">Prompt stays below activity</text>
        <Show when={picker()} keyed>
          {(current) => <ReleaseDismissDialog renderer={setup.renderer} input={current.input} close={closePicker} />}
        </Show>
      </box>
    );
  }, setup.renderer);
  const settle = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    await setup.renderOnce();
  };
  await settle();
  const node = (id) => setup.renderer.root.findDescendantById(id) ?? null;
  return {
    ...setup,
    settle,
    node,
    state,
    setState,
    setSessionID,
    context,
    listeners,
    navigations,
    selections,
    selection,
    syncs,
    listCalls,
    commands,
    contribution: () => contribution,
    unregister: () => unregister?.(),
    emit: (name, data) => { for (const listener of listeners.get(name) ?? []) listener({ type: name, data }); },
    click: async (id, button = 0) => {
      const target = node(id);
      expect(target).toBeDefined();
      await setup.mockMouse.click(target.x + 2, target.y, button, { delayMs: 0 });
      await settle();
    },
  };
}

test("appends a highlighted strip independently of the folded transcript and other composer contributions", async () => {
  const view = await mount({ sessions: [child("worker")], active: { worker: "running" } });
  expect(view.contribution().append).toBe("session.composer.top");
  const frame = view.captureCharFrame();
  expect(frame).toContain("+ 4 commands, 6 reads, 4 tools");
  expect(frame).toContain("Existing goal contribution");
  expect(frame).toContain("Subagents 1");
  expect(frame).toContain("running");
  expect(frame).toContain("explore: Map the plugin call path");
  expect(view.node("subagent-activity-open").backgroundColor).toEqual(theme.background.action.primary.base);
  expect(view.node("prompt").y).toBeGreaterThan(view.node("subagent-activity-worker").y);
});

test("empty, historical, archived, unrelated, and grandchildren do not create clutter", async () => {
  const view = await mount({
    sessions: [
      child("old", { outcome: "succeeded" }),
      child("idle"),
      child("archived", { time: { created: 1, updated: 1, archived: 2 } }),
      child("other", { parentID: "other-parent" }),
      child("grandchild", { parentID: "old" }),
    ],
    active: { other: "running", grandchild: "running" },
  });
  expect(view.node("subagent-activity")).toBeNull();
  expect(view.listCalls).toEqual([{ parentID: "parent", order: "desc" }]);
  expect(view.commands[0]().commands[0].enabled()).toBe(false);
});

test("primary clicks navigate to the native child; other mouse buttons do nothing and hover is visible", async () => {
  const view = await mount({ sessions: [child("worker")], active: { worker: "running" } });
  const row = view.node("subagent-activity-worker");
  await view.mockMouse.moveTo(row.x + 3, row.y);
  await view.settle();
  expect(row.backgroundColor).toEqual(theme.background.action.secondary.hovered);
  await view.click(row.id, 2);
  await view.click(row.id, 1);
  expect(view.navigations).toEqual([]);
  await view.click(row.id);
  expect(view.navigations).toEqual([{ type: "session", sessionID: "worker" }]);
});

test("a bounded strip keeps the full count and a picker reaches every child via mouse or command", async () => {
  const sessions = Array.from({ length: 7 }, (_, index) => child(`worker-${index}`));
  const view = await mount({ sessions, active: Object.fromEntries(sessions.map((session) => [session.id, "running"])) });
  const strip = view.node("subagent-activity");
  expect(strip.height).toBe(4);
  expect(view.captureCharFrame()).toContain("Subagents 7");
  expect(view.node("subagent-activity-worker-3")).toBeNull();
  await view.click("subagent-activity-open", 2);
  expect(view.selections).toHaveLength(0);
  await view.click("subagent-activity-open");
  expect(view.selections[0].options.map((option) => option.value)).toEqual(sessions.map((session) => session.id));
  view.selection.resolve("worker-6");
  await view.settle();
  expect(view.navigations).toEqual([{ type: "session", sessionID: "worker-6" }]);
  const command = view.commands[0]().commands[0];
  expect(command.slash.name).toBe("subagents");
  await command.run();
  expect(view.selections).toHaveLength(2);
});

test("a full header click leaves the release-dismiss picker open, the next outside click closes it, and a pick navigates once", async () => {
  const view = await mount({ sessions: [child("worker")], active: { worker: "running" }, renderDialog: true });
  const header = view.node("subagent-activity-open");
  const x = header.x + 2;
  const y = header.y;
  for (const button of [1, 2]) {
    await view.click(header.id, button);
    expect(view.node("picker-backdrop")).toBeNull();
  }

  await view.mockMouse.pressDown(x, y, 0, { delayMs: 0 });
  await view.settle();
  expect(view.node("picker-backdrop")).toBeNull();
  await view.mockMouse.release(x, y, 0, { delayMs: 0 });
  await view.settle();
  expect(view.node("picker-backdrop")).not.toBeNull();
  expect(view.captureCharFrame()).toContain("Subagent activity");
  expect(view.renderer.getSelection()).toBeNull();
  expect(view.navigations).toEqual([]);

  await view.mockMouse.click(1, 1, 0, { delayMs: 0 });
  await view.settle();
  expect(view.node("picker-backdrop")).toBeNull();
  expect(view.navigations).toEqual([]);

  await view.click(header.id);
  expect(view.node("picker-body")).not.toBeNull();
  await view.click("picker-worker");
  expect(view.node("picker-backdrop")).toBeNull();
  expect(view.navigations).toEqual([{ type: "session", sessionID: "worker" }]);
});

test("selecting activity text does not open the picker or navigate on release", async () => {
  const view = await mount({ sessions: [child("worker")], active: { worker: "running" }, renderDialog: true });
  for (const id of ["subagent-activity-open", "subagent-activity-worker"]) {
    const row = view.node(id);
    await view.mockMouse.drag(row.x + 2, row.y, row.x + 12, row.y, 0, { delayMs: 0 });
    await view.settle();
    expect(view.renderer.getSelection()?.getSelectedText()).toBeTruthy();
    expect(view.node("picker-backdrop")).toBeNull();
    expect(view.navigations).toEqual([]);
    view.renderer.clearSelection();
  }
});

test("pending, live start, retained completion and dismissal follow native state", async () => {
  const view = await mount({ sessions: [child("worker")], pending: { worker: [{ id: "queued", type: "user" }] } });
  expect(view.captureCharFrame()).toContain("pending");
  view.setState("pending", "worker", []);
  view.setState("active", "worker", "running");
  await view.settle();
  expect(view.captureCharFrame()).toContain("running");
  view.setState("sessions", 0, "outcome", "failed");
  view.setState("active", "worker", "idle");
  await view.settle();
  expect(view.captureCharFrame()).toContain("failed");
  expect(view.captureCharFrame()).toContain("Dismiss inactive");
  await view.click("subagent-activity-dismiss", 2);
  expect(view.node("subagent-activity-worker")).not.toBeNull();
  await view.click("subagent-activity-dismiss");
  expect(view.node("subagent-activity")).toBeNull();
});

test("a newly created or previously running child without an outcome is idle unless native work is queued", async () => {
  const view = await mount();
  view.emit("session.created", { sessionID: "worker", parentID: "parent" });
  view.setState("sessions", [child("worker")]);
  await view.settle();
  expect(view.captureCharFrame()).toContain("○ idle");
  expect(view.captureCharFrame()).not.toContain("pending");
  expect(view.captureCharFrame()).not.toContain("stopped");

  view.setState("pending", "worker", [{ id: "queued", type: "user" }]);
  await view.settle();
  expect(view.captureCharFrame()).toContain("pending");
  view.setState("active", "worker", "running");
  await view.settle();
  expect(view.captureCharFrame()).toContain("running");

  view.setState("pending", "worker", []);
  view.setState("active", "worker", "idle");
  await view.settle();
  expect(view.captureCharFrame()).toContain("○ idle");
  expect(view.captureCharFrame()).not.toContain("pending");
  expect(view.captureCharFrame()).not.toContain("stopped");
  expect(view.captureCharFrame()).toContain("Dismiss inactive");
  await view.click("subagent-activity-dismiss");
  expect(view.node("subagent-activity")).toBeNull();
});

test("quick completion is retained even when hydration never shows running; the next delegation clears it", async () => {
  const view = await mount();
  view.emit("session.created", { sessionID: "quick", parentID: "parent" });
  view.setState("sessions", [child("quick", { outcome: "succeeded" })]);
  await view.settle();
  expect(view.captureCharFrame()).toContain("done");
  expect(view.syncs).toContain("quick");
  view.emit("session.created", { sessionID: "next", parentID: "parent" });
  view.setState("sessions", (sessions) => [...sessions, child("next")]);
  await view.settle();
  expect(view.node("subagent-activity-quick")).toBeNull();
  expect(view.node("subagent-activity-next")).not.toBeNull();
});

test("cold child discovery hydrates native sessions, and active rows precede retained completions", async () => {
  const children = [child("done"), child("running", { time: { created: 1, updated: 2 } })];
  const view = await mount({
    active: { running: "running" },
    pending: { done: [{ id: "queued", type: "user" }] },
    list: async () => ({ data: children }),
    sync: async (id, update) => update("sessions", (sessions) => [...sessions, children.find((session) => session.id === id)]),
  });
  expect(view.syncs).toEqual(["done", "running"]);
  expect(view.captureCharFrame()).toContain("Subagents 2");
  view.setState("sessions", 0, "outcome", "succeeded");
  view.setState("pending", "done", []);
  view.setState("sessions", 0, "time", "updated", 10);
  await view.settle();
  expect(view.node("subagent-activity-running").y).toBeLessThan(view.node("subagent-activity-done").y);
});

test("multiple creation events survive out-of-order hydration without losing quick completions", async () => {
  const view = await mount();
  view.emit("session.created", { sessionID: "first", parentID: "parent" });
  view.emit("session.created", { sessionID: "second", parentID: "parent" });
  view.setState("sessions", [child("second", { outcome: "succeeded" }), child("first", { outcome: "succeeded" })]);
  await view.settle();
  expect(view.captureCharFrame()).toContain("Subagents 2");
  expect(view.node("subagent-activity-first")).not.toBeNull();
  expect(view.node("subagent-activity-second")).not.toBeNull();
});

test("queued resumed work and running work override the previous outcome", async () => {
  const view = await mount({
    sessions: [child("worker", { outcome: "succeeded" })],
    pending: { worker: [{ id: "queued", type: "user" }] },
  });
  expect(view.captureCharFrame()).toContain("pending");
  view.setState("pending", "worker", []);
  view.setState("active", "worker", "running");
  await view.settle();
  expect(view.captureCharFrame()).toContain("running");
  view.setState("sessions", 0, "outcome", "interrupted");
  view.setState("active", "worker", "idle");
  await view.settle();
  expect(view.captureCharFrame()).toContain("stopped");
  const selecting = view.commands[0]().commands[0].run();
  view.selections[0].actions[0].onTrigger();
  await selecting;
  expect(view.node("subagent-activity")).toBeNull();
});

test("late child-list results and open pickers cannot update or navigate after unmount", async () => {
  const response = deferred();
  const view = await mount({ list: () => response.promise });
  expect(view.listeners.get("session.created").size).toBe(1);
  view.unregister();
  await view.settle();
  expect(view.listeners.get("session.created").size).toBe(0);
  response.resolve({ data: [child("late")] });
  await view.settle();
  expect(view.syncs).toEqual([]);
  expect(view.node("subagent-activity")).toBeNull();

  const picker = await mount({ sessions: [child("worker")], active: { worker: "running" } });
  const selecting = picker.commands[0]().commands[0].run();
  picker.unregister();
  await picker.settle();
  picker.selection.resolve("worker");
  await selecting;
  expect(picker.navigations).toEqual([]);
});

test("changing the parent scopes the strip and replaces event subscriptions", async () => {
  const view = await mount({
    sessions: [child("first"), child("second", { parentID: "second-parent" })],
    active: { first: "running", second: "running" },
  });
  view.setSessionID("second-parent");
  await view.settle();
  expect(view.node("subagent-activity-first")).toBeNull();
  expect(view.node("subagent-activity-second")).not.toBeNull();
  expect(view.listeners.get("session.created").size).toBe(1);
  expect(view.listCalls.at(-1).parentID).toBe("second-parent");
  view.emit("session.created", { sessionID: "foreign", parentID: "parent" });
  expect(view.syncs).not.toContain("foreign");
});

test("sync failures offer a retry without hiding cached activity", async () => {
  let failed = true;
  const view = await mount({
    sessions: [child("worker")],
    active: { worker: "running" },
    list: async () => {
      if (failed) throw new Error("Offline");
      return { data: [] };
    },
  });
  expect(view.captureCharFrame()).toContain("Subagents unavailable");
  expect(view.node("subagent-activity-worker")).not.toBeNull();
  failed = false;
  await view.click("subagent-activity-retry");
  expect(view.node("subagent-activity-retry")).toBeNull();
});

test("activityStrip false disables only the CLI contribution", async () => {
  const view = await mount({ options: { activityStrip: false }, sessions: [child("worker")] });
  expect(view.contribution()).toBeUndefined();
  expect(view.commands).toEqual([]);
  expect(view.listCalls).toEqual([]);
});

for (const width of [32, 100]) {
  test(`one-line rows fit ${width} columns with long Unicode task labels and an accessible total`, async () => {
    const sessions = Array.from({ length: 8 }, (_, index) => child(`worker-${index}`, {
      title: "調査する 🔎 e\u0301 " + "A task with a very long description ".repeat(4),
    }));
    const view = await mount({
      width,
      sessions,
      pending: Object.fromEntries(sessions.map((session) => [session.id, [{ id: `queued-${session.id}`, type: "user" }]])),
    });
    const strip = view.node("subagent-activity");
    expect(strip.width).toBe(width);
    expect(strip.height).toBe(4);
    expect(view.captureCharFrame()).toContain("Subagents 8");
    expect(view.captureCharFrame()).toContain("Open all");
    expect(view.captureCharFrame()).toContain("(+5)");
    expect(view.captureCharFrame()).toContain("pending explore:");
    for (const row of strip.getChildren().filter((node) => typeof node.height === "number")) {
      expect(row.height).toBe(1);
      expect(row.x + row.width).toBeLessThanOrEqual(width);
      for (const text of row.getChildren()) expect(text.x + text.width).toBeLessThanOrEqual(width - 1);
    }
    expect(view.node("prompt").y).toBe(strip.y + strip.height);
  });
}
