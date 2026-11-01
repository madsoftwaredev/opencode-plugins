/** @jsxImportSource @opentui/solid */

import { afterEach, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { render } from "@opentui/solid";
import plugin from "./tui";

const cleanups = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function makeContext({ views = {} } = {}) {
  const state = { ...views };
  const rpcListeners = [];
  const dataListeners = [];
  let contribution;

  const context = {
    client: {
      rpc: () => ({
        state: async ({ sessionID }) => state[sessionID] ?? { active: false },
        events: {
          on: (_name, listener) => {
            rpcListeners.push(listener);
            return () => {};
          },
        },
      }),
    },
    data: {
      on: (_name, listener) => {
        dataListeners.push(listener);
        return () => {};
      },
    },
    // Host theme tokens are RGBA values; OpenTUI 0.8 rejects plain numbers.
    theme: {
      text: { base: RGBA.fromHex("#ffffff"), muted: RGBA.fromHex("#888888") },
      background: { raised: { base: RGBA.fromHex("#222222") } },
    },
    ui: {
      slot: (claim) => {
        contribution = claim;
        return () => {};
      },
    },
  };

  return {
    context,
    contribution: () => contribution,
    setView: (sessionID, view) => {
      state[sessionID] = view;
    },
    emitRpc: (event) => {
      for (const listener of rpcListeners) listener(event);
    },
    emitStatus: (event) => {
      for (const listener of dataListeners) listener(event);
    },
  };
}

function textLines(node) {
  const lines = [];
  const collect = (current, parts) => {
    for (const child of current.children ?? []) {
      if (typeof child === "string") parts.push(child);
      else collect(child, parts);
    }
  };
  const walk = (current) => {
    if (current.textNode) {
      const parts = [];
      collect(current.textNode, parts);
      if (parts.length) lines.push(parts.join(""));
    }
    for (const child of current.getChildren?.() ?? []) walk(child);
  };
  walk(node);
  return lines;
}

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

async function mount(fakes, sessionID = "ses_1") {
  const setup = await createTestRenderer({ width: 100, height: 20 });
  cleanups.push(() => setup.renderer.destroy());
  let unregister;
  let island;
  await render(() => {
    unregister = plugin.setup(fakes.context);
    return (
      <box width="100%" height="100%" flexDirection="column">
        <box
          ref={(node) => {
            island = node;
          }}
          width="100%"
          flexGrow={1}
        >
          {fakes.contribution().render({ sessionID })}
        </box>
      </box>
    );
  }, setup.renderer);
  await flush();
  await setup.renderOnce();
  return { ...setup, island, unregister: () => unregister() };
}

test("the slot claims session.composer.top", async () => {
  const fakes = makeContext();
  const view = await mount(fakes);
  expect(fakes.contribution().append).toBe("session.composer.top");
  view.unregister();
});

test("the island is hidden without a goal and shows the goal line when active", async () => {
  const hidden = makeContext();
  const first = await mount(hidden);
  expect(textLines(first.island)).toHaveLength(0);
  first.unregister();

  const fakes = makeContext({
    views: {
      ses_1: { active: true, text: "land the migration", status: "active", nudges: 3, budget: 12 },
    },
  });
  const view = await mount(fakes);
  expect(textLines(view.island).join("")).toContain("⚑ GOAL · land the migration · loop 3/12");
  view.unregister();
});

test("paused goals render muted with their reason", async () => {
  const fakes = makeContext({
    views: {
      ses_1: { active: true, text: "land the migration", status: "paused", pauseReason: "budget", nudges: 12, budget: 12 },
    },
  });
  const view = await mount(fakes);
  expect(textLines(view.island).join("")).toContain("⏸ GOAL · land the migration · paused (budget)");
  view.unregister();
});

test("inherited goals render as the parent's goal", async () => {
  const fakes = makeContext({
    views: {
      ses_child: { active: true, text: "land the migration", status: "active", nudges: 0, budget: 12, inherited: true },
    },
  });
  const view = await mount(fakes, "ses_child");
  expect(textLines(view.island).join("")).toContain("GOAL (parent)");
  view.unregister();
});

test("goal.updated events refresh the island live", async () => {
  const fakes = makeContext();
  const view = await mount(fakes);
  expect(textLines(view.island)).toHaveLength(0);

  fakes.setView("ses_1", { active: true, text: "ship it", status: "active", nudges: 0, budget: 12 });
  fakes.emitRpc({ type: "rpc.goal.updated", data: { sessionID: "ses_1", active: true } });
  await flush();
  await view.renderOnce();
  expect(textLines(view.island).join("")).toContain("ship it");

  fakes.setView("ses_1", { active: false });
  fakes.emitStatus({ type: "session.status", data: { sessionID: "ses_1" } });
  await flush();
  await view.renderOnce();
  expect(textLines(view.island)).toHaveLength(0);
  view.unregister();
});
