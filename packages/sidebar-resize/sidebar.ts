import type { CliRenderer, MouseEvent, Renderable, RGBA } from "@opentui/core";
import { clampWidth, DEFAULT_WIDTH } from "./width";

// OpenCode rewrites host-runtime imports in the TSX entrypoint, not this TS
// helper. Keep these imports type-only and receive the host's own constructors.
type Core = Pick<typeof import("@opentui/core"), "BoxRenderable" | "ScrollBoxRenderable" | "Yoga">;

type SidebarTarget = {
  sidebar: Renderable;
  pane: Renderable;
  overlay: boolean;
};

// OpenCode has no public sidebar-width API. Match only the inspected V2 host
// shape: padded sidebar containing a heading, a scrollbox, and our footer branch.
// Never resize an arbitrary ancestor when an OpenCode update changes that shape.
function findSidebar(anchor: Renderable, core: Core): SidebarTarget | undefined {
  const { Edge, PositionType, Unit } = core.Yoga;
  let branch = anchor;
  for (let node = anchor.parent; node; branch = node, node = node.parent) {
    const children = node.getChildren();
    // OpenTUI 0.6.6 exposes style getters on Renderable itself; getLayout()
    // returns computed geometry, not the removed Yoga node or its style values.
    if (
      children.length !== 3 ||
      !(children[1] instanceof core.ScrollBoxRenderable) ||
      children[2] !== branch ||
      node.getPadding(Edge.Left).value !== 2 ||
      node.getPadding(Edge.Right).value !== 2 ||
      node.getWidth().unit !== Unit.Point ||
      node.getWidth().value !== DEFAULT_WIDTH
    )
      continue;

    const pane = node.parent;
    if (!pane) return undefined;
    const width = pane.getWidth();
    const overlay = pane.getPositionType() === PositionType.Absolute;
    if (overlay && width.unit === Unit.Percent && width.value === 100) {
      return { sidebar: node, pane, overlay: true };
    }
    if (!overlay && width.unit === Unit.Point && width.value === DEFAULT_WIDTH) {
      return { sidebar: node, pane, overlay: false };
    }
    return undefined;
  }
  return undefined;
}

export function attachSidebarResize(options: {
  core: Core;
  anchor: Renderable;
  renderer: CliRenderer;
  width: () => number;
  save: (width: number) => void;
  highlight: () => RGBA;
}): { refresh: () => void; dispose: () => void } | undefined {
  const target = findSidebar(options.anchor, options.core);
  if (!target) return undefined;
  const { sidebar, pane, overlay } = target;
  let disposed = false;
  let scheduled = false;
  let drag: { right: number; offset: number; width: number } | undefined;

  const available = () => (overlay ? pane.width : pane.parent?.width) || options.renderer.width;
  const apply = (width: number) => {
    if (disposed || sidebar.isDestroyed || pane.isDestroyed) return;
    const next = clampWidth(width, available(), overlay);
    // Both widths are fixed by the host. Updating only the inner box would
    // overlap the transcript rather than give the whole sidebar more room.
    if (sidebar.getWidth().value !== next) sidebar.width = next;
    if (!overlay && pane.getWidth().value !== next) pane.width = next;
  };
  const refresh = () => apply(drag?.width ?? options.width());
  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      refresh();
    });
  };
  const stop = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const finish = (event: MouseEvent) => {
    if (!drag) return;
    stop(event);
    const width = drag.width;
    drag = undefined;
    handle.backgroundColor = undefined;
    options.save(width);
  };
  const move = (event: MouseEvent) => {
    if (!drag) return;
    stop(event);
    drag.width = clampWidth(drag.right - event.x + drag.offset, available(), overlay);
    apply(drag.width);
  };
  const handle = new options.core.BoxRenderable(options.renderer, {
    id: "sidebar-resize.handle",
    position: "absolute",
    left: 0,
    top: 0,
    width: 2,
    height: "100%",
    zIndex: 10,
    onMouseOver: () => {
      handle.backgroundColor = options.highlight();
    },
    onMouseOut: () => {
      if (!drag) handle.backgroundColor = undefined;
    },
    onMouseDown: (event) => {
      if (event.button !== 0) return;
      stop(event);
      drag = {
        right: sidebar.x + sidebar.width,
        offset: event.x - sidebar.x,
        width: sidebar.width,
      };
      handle.backgroundColor = options.highlight();
    },
    onMouseDrag: move,
    onMouseDragEnd: finish,
    onMouseUp: finish,
  });
  sidebar.add(handle);
  // In the shipped OpenTUI, capture begins at the first drag's hit target,
  // not the mouse-down target. Catch bubbled drags even when that first move
  // jumps past the two-cell handle; preserve normal dispatch when not dragging.
  const root = options.renderer.root;
  const originalMouse = root.processMouseEvent;
  const dispatchMouse = (event: MouseEvent) => {
    if (!disposed && drag) {
      if (event.type === "drag") return move(event);
      if (event.type === "drag-end" || event.type === "up") return finish(event);
    }
    originalMouse.call(root, event);
  };
  root.processMouseEvent = dispatchMouse;
  const watched = [...new Set([sidebar, pane, pane.parent].filter((node) => node !== null))];
  for (const node of watched) node.on("resize", schedule);
  options.renderer.on("resize", schedule);
  refresh();

  return {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const node of watched) node.off("resize", schedule);
      options.renderer.off("resize", schedule);
      if (root.processMouseEvent === dispatchMouse) root.processMouseEvent = originalMouse;
      if (!handle.isDestroyed) handle.destroy();
      if (!sidebar.isDestroyed) sidebar.width = DEFAULT_WIDTH;
      if (!overlay && !pane.isDestroyed) pane.width = DEFAULT_WIDTH;
    },
  };
}
