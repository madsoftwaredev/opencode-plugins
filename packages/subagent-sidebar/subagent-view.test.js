import { describe, expect, test } from "bun:test"
import { descendantSessions, subagentStatus, subagentTask } from "./subagent-view.ts"

const session = (id, parentID, updated, outcome) => ({
  id,
  parentID,
  time: { updated },
  ...(outcome ? { outcome } : {}),
})

describe("subagent sidebar data", () => {
  test("finds and orders descendants without including the parent", () => {
    const sessions = [
      session("child-old", "root", 10),
      session("grandchild", "child-old", 30),
      session("child-new", "root", 20),
      session("other", "else", 40),
    ]

    expect(descendantSessions(sessions, "root").map(({ id }) => id)).toEqual([
      "grandchild",
      "child-new",
      "child-old",
    ])
  })

  test("maps live and terminal session states", () => {
    expect(subagentStatus({}, "running")).toBe("running")
    expect(subagentStatus({ outcome: "succeeded" }, "idle")).toBe("done")
    expect(subagentStatus({ outcome: "failed" }, "idle")).toBe("failed")
    expect(subagentStatus({}, "idle")).toBe("idle")
  })

  test("prefers current tool activity while running and the original task otherwise", () => {
    const messages = [
      { type: "user", text: "Implement the sidebar" },
      {
        type: "assistant",
        content: [
          {
            type: "tool",
            name: "read",
            state: { status: "running", input: { path: "src/app.ts" } },
          },
        ],
      },
    ]

    expect(subagentTask(messages, "running")).toBe("read · src/app.ts")
    expect(subagentTask(messages, "idle")).toBe("Implement the sidebar")
  })
})
