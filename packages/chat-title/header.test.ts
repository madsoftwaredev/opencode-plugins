import { expect, test } from "bun:test"
import { PADDING_X, attachHeader, findSessionColumn, type Core, type Node } from "./header"

const EDGE_BOTTOM = 3
const UNIT_POINT = 1
const FLEX_ROW = 2

type Layout = {
  padding?: number
  flexGrow?: number
  flexShrink?: number
  flexDirection?: number
  height?: number
}

class FakeNode implements Node {
  children: FakeNode[] = []
  isDestroyed = false
  width = 0
  parent: FakeNode | null = null
  onSizeChange?: () => void

  constructor(
    readonly ctx: unknown,
    readonly layout: Layout = {},
  ) {}

  getChildren() {
    return [...this.children]
  }

  getPadding() { return { unit: UNIT_POINT, value: this.layout.padding ?? 0 } }
  getFlexGrow() { return this.layout.flexGrow ?? 0 }
  getFlexShrink() { return this.layout.flexShrink ?? 0 }
  getFlexDirection() { return this.layout.flexDirection ?? 0 }
  getHeight() { return { unit: UNIT_POINT, value: this.layout.height ?? 0 } }

  add(child: FakeNode, index = this.children.length) {
    child.parent = this
    this.children.splice(index, 0, child)
    return index
  }

  remove(child: FakeNode) {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parent = null
  }

  destroy() {
    if (this.isDestroyed) return
    this.isDestroyed = true
    if (this.parent) this.parent.remove(this)
  }
}

class FakeLabel extends FakeNode {
  content = ""
}

class FakeScrollbox extends FakeNode {}

const core = {
  BoxRenderable: FakeNode,
  ScrollBoxRenderable: FakeScrollbox,
  TextRenderable: FakeLabel,
  Yoga: { Edge: { Bottom: EDGE_BOTTOM }, Unit: { Point: UNIT_POINT }, FlexDirection: { Row: FLEX_ROW } },
} as unknown as Core

/** The row shape OpenCode 2.0.26 builds for a session view. */
function sessionTree() {
  const pane = new FakeNode({}, { flexDirection: FLEX_ROW, flexGrow: 1 })
  const column = new FakeNode({}, { flexGrow: 1, padding: 1 })
  const transcript = new FakeNode({}, { flexGrow: 1 })
  const jump = new FakeNode({}, { height: 1, flexShrink: 0 })
  const composer = new FakeNode({}, { flexShrink: 0 })
  const anchor = new FakeNode({})

  transcript.add(new FakeScrollbox({}, { flexGrow: 1 }))
  column.add(transcript)
  column.add(jump)
  column.add(composer)
  composer.add(anchor)
  pane.add(column)

  return { pane, column, transcript, jump, composer, anchor }
}

function attach(tree: ReturnType<typeof sessionTree>, title: () => string) {
  return attachHeader({ core, anchor: tree.anchor, renderer: {}, title, color: () => "white" })
}

test("findSessionColumn walks from the composer anchor to the session column", () => {
  const tree = sessionTree()
  expect(findSessionColumn(tree.anchor, core)).toBe(tree.column)
})

test("findSessionColumn refuses a column without the transcript scrollbox", () => {
  const tree = sessionTree()
  tree.transcript.remove(tree.transcript.getChildren()[0])
  expect(findSessionColumn(tree.anchor, core)).toBeUndefined()
})

test("findSessionColumn refuses a column whose bottom padding changed", () => {
  const tree = sessionTree()
  tree.column.layout.padding = 0
  expect(findSessionColumn(tree.anchor, core)).toBeUndefined()
})

test("findSessionColumn refuses a column with a different row count", () => {
  const tree = sessionTree()
  tree.column.add(new FakeNode({}))
  expect(findSessionColumn(tree.anchor, core)).toBeUndefined()
})

test("findSessionColumn refuses a jump row that is not one cell tall", () => {
  const tree = sessionTree()
  tree.jump.layout.height = 2
  expect(findSessionColumn(tree.anchor, core)).toBeUndefined()
})

test("findSessionColumn refuses a column that is not a row child", () => {
  const tree = sessionTree()
  tree.pane.layout.flexDirection = 0
  expect(findSessionColumn(tree.anchor, core)).toBeUndefined()
})

test("findSessionColumn returns undefined when the anchor is detached", () => {
  const tree = sessionTree()
  tree.composer.remove(tree.anchor)
  expect(findSessionColumn(tree.anchor, core)).toBeUndefined()
})

test("attachHeader inserts the title above the transcript", () => {
  const tree = sessionTree()
  const attachment = attach(tree, () => "fix the plugin loader")
  expect(attachment).toBeDefined()

  const rows = tree.column.getChildren()
  expect(rows).toHaveLength(4)
  expect(rows[1]).toBe(tree.transcript)
  expect(rows[3]).toBe(tree.composer)

  attachment!.dispose()
})

test("attachHeader renders nothing until layout gives the row a width", () => {
  const tree = sessionTree()
  const attachment = attach(tree, () => "fix the plugin loader")!
  const header = tree.column.getChildren()[0]
  const label = header.getChildren()[0] as FakeLabel
  expect(label.content).toBe("")

  header.width = 40
  header.onSizeChange?.()
  expect(label.content).toBe("fix the plugin loader")

  attachment.dispose()
})

test("attachHeader refits the label on refresh and on resize", () => {
  const tree = sessionTree()
  let title = "a very long chat title that will not fit"
  const attachment = attach(tree, () => title)!
  const header = tree.column.getChildren()[0]
  const label = header.getChildren()[0] as FakeLabel

  header.width = 20
  header.onSizeChange?.()
  expect(label.content.endsWith("…")).toBe(true)
  expect(label.content.length).toBeLessThanOrEqual(20 - PADDING_X * 2)

  title = "short"
  attachment.refresh()
  expect(label.content).toBe("short")
})

test("attachHeader dispose removes the row and destroys the label", () => {
  const tree = sessionTree()
  const attachment = attach(tree, () => "fix the plugin loader")!
  const header = tree.column.getChildren()[0]
  const label = header.getChildren()[0]

  attachment.dispose()
  expect(label.isDestroyed).toBe(true)
  expect(header.isDestroyed).toBe(true)
  expect(tree.column.getChildren()).toHaveLength(3)
})

test("attachHeader refresh after dispose is inert", () => {
  const tree = sessionTree()
  const attachment = attach(tree, () => "fix the plugin loader")!
  attachment.dispose()
  expect(() => attachment.refresh()).not.toThrow()
  expect(() => attachment.dispose()).not.toThrow()
})
