import type { Plugin } from "@opencode/plugin";
import type { Info } from "@opencode/plugin/promise/tool";

function defaultBackground(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;

  const value = input as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(value, "background")) return input;

  return { ...value, background: true };
}

const guidance =
  "\n\nBackground is the default. Set `background: false` only when the parent must receive the result before continuing.";

export default {
  id: "local.background-subagent",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.update("subagent", (tool) => {
        const execute: Info["execute"] = tool.execute;
        tool.description = tool.description.includes("Background is the default")
          ? tool.description
          : `${tool.description}${guidance}`;
        tool.execute = async (input, context) => execute(defaultBackground(input), context);
      });
    });
  },
} satisfies Plugin.Plugin;
