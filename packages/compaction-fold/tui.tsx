/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode/plugin/tui";
import { BoxRenderable, ScrollBoxRenderable, TextRenderable, MarkdownRenderable, Yoga } from "@opentui/core";
import { createMemo, onCleanup, onMount } from "solid-js";
import { attachCompactionFold } from "./fold";
import { parseOptions } from "./options";

export default Plugin.define({
  id: "compaction-fold",
  setup(context) {
    const options = parseOptions(context.options);
    return context.ui.slot({
      append: "session.composer.top",
      render(input) {
        let anchor: BoxRenderable | undefined;
        let attachment: ReturnType<typeof attachCompactionFold>;
        const summaries = createMemo(() =>
          (context.data.session.message.list(input.sessionID) ?? []).flatMap((message) =>
            message.type === "compaction" && (message.status === "running" || message.status === "completed")
              ? [{ id: message.id, summary: message.summary }]
              : [],
          ),
        );
        const unsupported = () => context.ui.toast.show({
          message: "Compaction fold: unsupported OpenCode layout; summaries left visible.",
          variant: "warning",
        });
        onMount(() => {
          if (!anchor) return;
          attachment = attachCompactionFold({
            core: { BoxRenderable, ScrollBoxRenderable, TextRenderable, MarkdownRenderable, Yoga },
            anchor,
            renderer: context.renderer,
            summaries,
            defaultExpanded: options.defaultExpanded,
            color: () => context.theme.text.action.secondary.base,
            unsupported,
          });
          if (!attachment) unsupported();
        });
        onCleanup(() => attachment?.dispose());
        return <box ref={(node) => { anchor = node; }} id="compaction-fold.anchor" visible={false} width={0} height={0} />;
      },
    });
  },
});
