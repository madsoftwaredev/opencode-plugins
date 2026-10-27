import { fitTitle } from "./title"

// OpenCode publishes no slot above the session transcript, so the header is
// inserted into the host's render tree. OpenCode rewrites "@opentui/*"
// specifiers in the TSX entrypoint only, so this helper stays free of those
// imports and receives the host's own constructors from the entrypoint instead.

/** Cells kept clear on each side of the title text. */
export const PADDING_X = 2

export type YogaValue = { readonly unit: number; readonly value: number }

export type YogaLayout = {
  getPadding(edge: number): YogaValue
  getFlexGrow(): number
  getFlexShrink(): number
  getFlexDirection(): number
  getHeight(): YogaValue
}

export type Node = YogaLayout & {
  readonly isDestroyed: boolean
  readonly parent: Node | null
  readonly width: number
  getChildren(): Node[]
  onSizeChange?: () => void
  add(child: unknown, index?: number): number
  destroy(): void
}

export type LabelNode = Node & { content: string }

export type Core = {
  BoxRenderable: new (ctx: unknown, options: Record<string, unknown>) => Node
  ScrollBoxRenderable: new (...args: never[]) => Node
  TextRenderable: new (ctx: unknown, options: Record<string, unknown>) => LabelNode
  Yoga: {
    Edge: { Bottom: number }
    Unit: { Point: number }
    FlexDirection: { Row: number }
  }
}

export type Attachment = {
  /** Re-read the title and refit it to the current column width. */
  refresh: () => void
  dispose: () => void
}

export type AttachOptions = {
  core: Core
  anchor: Node
  renderer: { requestRender?: () => void }
  title: () => string
  color: () => unknown
}

// OpenCode has no public slot or API for a transcript header. Match only the
// inspected V2 host shape: a column holding the transcript, the one-row
// "jump to latest" bar, and the composer block that owns our anchor. Never
// insert into an unrecognized ancestor when an OpenCode update changes it.
function isColumn(node: Node, branch: Node, core: Core): boolean {
  const children = node.getChildren()
  if (children.length !== 3 || children[2] !== branch) return false
  if (!(children[0] instanceof core.BoxRenderable)) return false
  if (!(children[0].getChildren()[0] instanceof core.ScrollBoxRenderable)) return false

  const jump = children[1]
  const jumpHeight = jump.getHeight()
  if (jumpHeight.unit !== core.Yoga.Unit.Point || jumpHeight.value !== 1) return false
  if (jump.getFlexShrink() !== 0) return false

  const padding = node.getPadding(core.Yoga.Edge.Bottom)
  if (padding.unit !== core.Yoga.Unit.Point || padding.value !== 1) return false
  if (node.getFlexGrow() !== 1) return false

  // The column sits beside the sidebar, so its own parent is a row.
  const parent = node.parent
  if (!parent) return false
  return parent.getFlexDirection() === core.Yoga.FlexDirection.Row
}

/**
 * Walk up from the composer anchor to the session column. Returns undefined
 * unless every row matches, so an unsupported layout shows no header at all
 * rather than painting one in the wrong place.
 */
export function findSessionColumn(anchor: Node, core: Core): Node | undefined {
  let branch: Node = anchor
  for (let node = anchor.parent; node; branch = node, node = node.parent) {
    if (isColumn(node, branch, core)) return node
  }
  return undefined
}

/**
 * Insert a one-row title above the session transcript. The host column is a
 * flexbox, so the header takes a row from the transcript instead of covering it.
 */
export function attachHeader(options: AttachOptions): Attachment | undefined {
  let column: Node | undefined
  try {
    column = findSessionColumn(options.anchor, options.core)
  } catch (error) {
    console.warn("[chat-title] Unsupported render tree; the chat title is hidden", error)
    return undefined
  }
  if (!column) return undefined

  const header = new options.core.BoxRenderable(options.renderer, {
    id: "chat-title.header",
    height: 1,
    flexShrink: 0,
    flexDirection: "row",
    paddingLeft: PADDING_X,
    paddingRight: PADDING_X,
  })
  const label = new options.core.TextRenderable(options.renderer, {
    fg: options.color(),
    wrapMode: "none",
    truncate: true,
    flexGrow: 1,
    minWidth: 0,
  })
  header.add(label)
  column.add(header, 0)
  // Request a frame so native layout measures the row and invokes onSizeChange.
  options.renderer.requestRender?.()

  let disposed = false
  let rendered = ""
  const refresh = () => {
    if (disposed || header.isDestroyed || column.isDestroyed) return
    const width = header.width - PADDING_X * 2
    // Layout has not run yet on the first pass; the resize handler refits.
    if (width < 1) return
    const next = fitTitle(options.title(), width)
    if (next === rendered) return
    rendered = next
    label.content = next
  }

  header.onSizeChange = refresh
  refresh()

  return {
    refresh,
    dispose() {
      if (disposed) return
      disposed = true
      if (!header.isDestroyed) header.onSizeChange = undefined
      // The host detaches children without destroying them, so drop the label
      // first and then the row itself.
      if (!label.isDestroyed) label.destroy()
      if (!header.isDestroyed) header.destroy()
    },
  }
}
