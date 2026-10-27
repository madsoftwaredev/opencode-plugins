import type { BoxRenderable, CliRenderer, MarkdownRenderable, Renderable, RGBA, TextRenderable } from "@opentui/core";

// Only the entrypoint's OpenTUI imports are rewritten by OpenCode. Helpers must
// receive host constructors rather than load a second copy of the runtime.
type Core = Pick<
  typeof import("@opentui/core"),
  "BoxRenderable" | "ScrollBoxRenderable" | "TextRenderable" | "MarkdownRenderable" | "Yoga"
>;
export type Summary = { id: string; summary: string };
type Fold = {
  messageID: string;
  body: Renderable;
  control: BoxRenderable;
  label: TextRenderable;
  visible: boolean;
};

function findTranscript(anchor: Renderable, core: Core) {
  const { Edge, Unit, FlexDirection } = core.Yoga;
  let branch = anchor;
  for (let node = anchor.parent; node; branch = node, node = node.parent) {
    // Read the final three children so a chat-title header can coexist above them.
    const [transcript, jump, composer] = node.getChildren().slice(-3);
    if (composer !== branch || !(transcript instanceof core.BoxRenderable) || !jump) continue;
    const scroll = transcript.getChildren()[0];
    if (!(scroll instanceof core.ScrollBoxRenderable)) continue;
    const height = jump.getHeight();
    const padding = node.getPadding(Edge.Bottom);
    if (
      height.unit === Unit.Point && height.value === 1 && jump.getFlexShrink() === 0 &&
      padding.unit === Unit.Point && padding.value === 1 && node.getFlexGrow() === 1 &&
      node.parent?.getFlexDirection() === FlexDirection.Row
    ) return scroll;
  }
}

function summaryBody(
  row: Renderable,
  core: Core,
  control?: Renderable,
): { box: BoxRenderable; body: BoxRenderable; markdown: MarkdownRenderable } | undefined {
  if (!(row instanceof core.BoxRenderable)) return;
  const children = row.getChildren();
  if (children.length !== 1 || !(children[0] instanceof core.BoxRenderable)) return;
  const box = children[0];
  const parts = box.getChildren().filter((child) => child !== control);
  if (parts.length !== 2) return;
  const [heading, body] = parts;
  if (!(heading instanceof core.BoxRenderable) || !(body instanceof core.BoxRenderable)) return;
  const { Edge, Unit, FlexDirection } = core.Yoga;
  if (heading.getFlexDirection() !== FlexDirection.Row) return;
  const header = heading.getChildren();
  if (header.length !== 3 || !header.every((node) => node instanceof core.BoxRenderable)) return;
  for (const line of [header[0], header[2]] as BoxRenderable[]) {
    if (!Array.isArray(line.border) || line.border.length !== 1 || line.border[0] !== "top") return;
    if (line.getFlexGrow() !== 1) return;
  }
  if (header[1].getFlexDirection() !== FlexDirection.Row) return;
  if (!header[1].getChildren().some((node) => {
    if (!(node instanceof core.TextRenderable)) return false;
    // JSX text is committed to plainText during layout, after frame callbacks.
    // Read the literal text children without consuming their dirty state.
    const children = node.textNode.children.flatMap((child) => typeof child === "string" ? [child] : child.children);
    if (!children.every((child) => typeof child === "string")) return false;
    const text = node.textNode.isDirty && children.length ? children.join("") : node.plainText;
    return text === "Compaction" || text === "Provider compaction";
  })) return;
  const top = body.getPadding(Edge.Top);
  const left = body.getPadding(Edge.Left);
  if (top.unit !== Unit.Point || top.value !== 1 || left.unit !== Unit.Point || left.value !== 3) return;
  const content = body.getChildren();
  if (content.length !== 1 || !(content[0] instanceof core.MarkdownRenderable)) return;
  return { box, body, markdown: content[0] };
}

/** Attach only to the inspected V2 transcript shape; unknown layouts stay intact. */
export function attachCompactionFold(options: {
  core: Core;
  anchor: Renderable;
  renderer: CliRenderer;
  summaries: () => readonly Summary[];
  defaultExpanded: boolean;
  color: () => RGBA;
  unsupported: () => void;
}): { refresh: () => void; dispose: () => void } | undefined {
  let scroll;
  try {
    scroll = findTranscript(options.anchor, options.core);
  } catch (error) {
    // Discovery happens before the guarded frame callback, during slot mounting.
    console.warn("[compaction-fold] Unsupported render tree; summaries left visible", error);
    return;
  }
  if (!scroll) return;
  const folds = new Map<Renderable, Fold>();
  // Kept across host row remounts, but only for this mounted session view.
  const expanded = new Map<string, boolean>();
  let previousSummaries: readonly Summary[] | undefined;
  const byText = new Map<string, Summary | undefined>();
  let disposed = false;
  const remove = (row: Renderable, fold: Fold) => {
    if (!fold.body.isDestroyed) fold.body.visible = fold.visible;
    if (!fold.label.isDestroyed) fold.label.destroy();
    if (!fold.control.isDestroyed) fold.control.destroy();
    folds.delete(row);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    options.renderer.removeFrameCallback(frame);
    for (const [row, fold] of folds) remove(row, fold);
    expanded.clear();
  };
  const refresh = () => {
    if (disposed) return;
    if (scroll.isDestroyed || options.anchor.isDestroyed) return dispose();
    // Exact body text is a cross-check against typed compaction metadata, never
    // a text heuristic. Duplicate summaries are ambiguous and intentionally skipped.
    const summaries = options.summaries();
    if (summaries !== previousSummaries) {
      previousSummaries = summaries;
      byText.clear();
      for (const summary of summaries) {
        const text = summary.summary.trim();
        if (text) byText.set(text, byText.has(text) ? undefined : summary);
      }
    }
    const rows = scroll.content.getChildren();
    const mounted = new Set(rows);
    for (const [row, fold] of folds) {
      if (!mounted.has(row) || row.isDestroyed) remove(row, fold);
    }
    // Only direct transcript rows and their shallow compaction shape are visited;
    // never traverse Markdown, tool output, or the whole app tree.
    for (const row of rows) {
      let fold = folds.get(row);
      const target = summaryBody(row, options.core, fold?.control);
      const summary = target && byText.get(target.markdown.content);
      if (fold && (!summary || fold.messageID !== summary.id || fold.body !== target?.body ||
        fold.control.isDestroyed || fold.label.isDestroyed || fold.control.parent !== target?.box)) {
        remove(row, fold);
        fold = undefined;
      }
      if (!summary || !target) continue;
      if (fold) {
        fold.label.fg = options.color();
        continue;
      }
      // Do not make a body hidden by the host or another plugin visible.
      if (!target.body.visible) continue;
      const { body, box } = target;
      const control = new options.core.BoxRenderable(options.renderer, {
        id: "compaction-fold.control",
        height: 1,
        flexShrink: 0,
        marginTop: 1,
        paddingLeft: 3,
        onMouseUp(event) {
          if (event.button !== 0 || disposed) return;
          event.preventDefault();
          event.stopPropagation();
          expanded.set(summary.id, !(expanded.get(summary.id) ?? options.defaultExpanded));
          apply();
        },
      });
      const label = new options.core.TextRenderable(options.renderer, {
        fg: options.color(), wrapMode: "none", truncate: true,
      });
      const apply = () => {
        const open = expanded.get(summary.id) ?? options.defaultExpanded;
        label.content = `${open ? "▼" : "▶"} Compaction summary`;
        body.visible = open;
      };
      control.add(label);
      box.add(control, 1);
      folds.set(row, { messageID: summary.id, body, control, label, visible: body.visible });
      apply();
    }
  };
  const frame = async () => {
    try {
      refresh();
    } catch (error) {
      dispose();
      console.warn("[compaction-fold] Unsupported render tree; summaries restored", error);
      options.unsupported();
    }
  };
  // Frame callbacks run before layout, including rows created by history loading
  // and streaming. Registering one does not request live/continuous rendering.
  options.renderer.setFrameCallback(frame);
  void frame();
  return { refresh, dispose };
}
