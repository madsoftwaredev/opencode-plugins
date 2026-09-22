import { expect, test } from "bun:test";
import plugin from "./index";

const context = {
  sessionID: "ses_parent",
  agent: "orchestrator",
  messageID: "msg_parent",
  id: "call_subagent",
  progress: async () => {},
};

async function setup() {
  const calls = [];
  const tool = {
    description: "Start a child session.",
    async execute(input, receivedContext) {
      calls.push({ input, context: receivedContext });
      return { content: "child started" };
    },
  };

  await plugin.setup({
    tool: {
      async transform(callback) {
        callback({
          update(_id, update) {
            update(tool);
          },
        });
      },
    },
  });

  return { calls, tool };
}

test("defaults omitted background to true without changing the original input", async () => {
  const harness = await setup();
  const input = { agent: "explore", description: "Map the code", prompt: "Inspect the repository" };

  await harness.tool.execute(input, context);

  expect(harness.calls).toEqual([{ input: { ...input, background: true }, context }]);
  expect(input).not.toHaveProperty("background");
  expect(harness.tool.description).toContain("Background is the default");
});

test("preserves explicit foreground and background choices", async () => {
  const harness = await setup();
  const foreground = { agent: "implementation-engineer", background: false };
  const background = { agent: "repository-analyst", background: true };

  await harness.tool.execute(foreground, context);
  await harness.tool.execute(background, context);

  expect(harness.calls[0].input).toBe(foreground);
  expect(harness.calls[1].input).toBe(background);
});
