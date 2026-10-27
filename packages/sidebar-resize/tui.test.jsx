/** @jsxImportSource @opentui/solid */

import { afterEach, expect, spyOn, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { render } from "@opentui/solid";
import { createSignal, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import plugin from "./tui";

const cleanups = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

async function mount() {
  const setup = await createTestRenderer({ width: 180, height: 30 });
  cleanups.push(() => setup.renderer.destroy());
  let unregister;
  let command;
  let sidebar;
  let failSave = false;
  const toasts = [];
  const [settings, setSettings] = createStore({ width: 60 });
  const [enabled, setEnabled] = createSignal(true);
  let contribution;
  const context = {
    renderer: setup.renderer,
    storage: {
      store: () => [
        settings,
        async (mutation) => {
          if (failSave) throw new Error("Disk full");
          setSettings(produce(mutation));
        },
      ],
    },
    theme: { background: { raised: { high: RGBA.fromHex("#345678") } } },
    keymap: {
      layer: (factory) => {
        command = factory().commands[0];
      },
    },
    ui: {
      dialog: { prompt: async () => "72" },
      slot: (claim) => {
        contribution = claim;
        return () => setEnabled(false);
      },
      toast: { show: (toast) => toasts.push(toast) },
    },
  };
  await render(() => {
    unregister = plugin.setup(context);
    return (
      <box width="100%" height="100%" flexDirection="row">
        <box flexGrow={1} minWidth={0} />
        <box width={42} height="100%" flexShrink={0}>
          <box
            ref={(node) => {
              sidebar = node;
            }}
            width={42}
            height="100%"
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
          >
            <box flexShrink={0} paddingRight={2} paddingBottom={1}>
              <text>Session title</text>
            </box>
            <scrollbox flexGrow={1} minHeight={0}>
              <box flexShrink={0} gap={1} paddingRight={1}>
                <text>Existing sidebar contents</text>
              </box>
            </scrollbox>
            <box flexShrink={0} gap={1} paddingTop={1}>
              <Show when={enabled()}>{contribution.render({ sessionID: "session" })}</Show>
            </box>
          </box>
        </box>
      </box>
    );
  }, setup.renderer);
  await setup.renderOnce();
  return {
    ...setup,
    sidebar,
    command,
    unregister,
    settings,
    toasts,
    failSave: () => {
      failSave = true;
    },
  };
}

test("Solid footer contribution mounts in the inspected host shape and reloads a saved width", async () => {
  const view = await mount();
  expect(view.sidebar.width).toBe(60);
  expect(view.toasts).toEqual([]);
  await view.command.run();
  await view.renderOnce();
  expect(view.sidebar.width).toBe(72);
  expect(view.settings.width).toBe(72);
  await view.command.run("reset");
  await view.renderOnce();
  expect(view.sidebar.width).toBe(42);
  view.unregister();
  await view.renderOnce();
  expect(view.sidebar.getChildren()).toHaveLength(3);
});

test("invalid commands and persistence failures leave the saved sidebar width intact", async () => {
  const view = await mount();
  await view.command.run("nope");
  expect(view.settings.width).toBe(60);
  expect(view.toasts.at(-1).variant).toBe("error");
  view.failSave();
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  cleanups.push(() => warning.mockRestore());
  await view.command.run("72");
  await view.renderOnce();
  expect(view.sidebar.width).toBe(60);
  expect(view.settings.width).toBe(60);
  expect(view.toasts.at(-1).variant).toBe("error");
  expect(warning).toHaveBeenCalled();
});
