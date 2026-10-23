import { describe, expect, test } from "bun:test"
import { resolveOptions, sidebarSessions } from "./options.ts"
import { subagentStatus } from "./subagent-view.ts"

const session = (id, updated, running = false, outcome = undefined) => ({
  id,
  time: { updated },
  running,
  ...(outcome ? { outcome } : {}),
})

const statusOf = (session) => subagentStatus(session, session.running ? "running" : "idle")
const updatedOf = (session) => session.time.updated

describe("subagent sidebar options", () => {
  test("defaults show every status and keep recent order", () => {
    const options = resolveOptions(undefined)
    expect(options.show).toEqual({
      running: true,
      idle: true,
      done: true,
      failed: true,
      stopped: true,
    })
    expect(options.sortBy).toBe("recent")
  })

  test("explicit show and hide compose, with hide applied last", () => {
    const options = resolveOptions({ show: { idle: true, failed: false }, hide: ["running"] })
    expect(options.show).toEqual({
      running: false,
      idle: true,
      done: true,
      failed: false,
      stopped: true,
    })
  })

  test("hide wins over show for the same status", () => {
    expect(resolveOptions({ show: { running: true }, hide: ["running"] }).show.running).toBe(false)
  })

  test("unknown and malformed option values fall back to defaults", () => {
    const options = resolveOptions({ sortBy: "alphabetical", show: { idle: "yes" }, bogus: 1 })
    expect(options.sortBy).toBe("recent")
    expect(options.show.idle).toBe(true)
  })

  test("recent order shows every visible row by most recent activity", () => {
    const rows = [session("old", 10), session("new", 90), session("mid", 40)]
    const result = sidebarSessions(rows, resolveOptions(undefined), statusOf, updatedOf)
    expect(result.map(({ id }) => id)).toEqual(["new", "mid", "old"])
  })

  test("active order puts running rows first with recency as the secondary key", () => {
    const rows = [
      session("idle-new", 90),
      session("run-old", 20, true),
      session("idle-old", 10),
      session("run-new", 50, true),
      session("idle-mid", 40),
    ]
    const result = sidebarSessions(
      rows,
      resolveOptions({ sortBy: "active" }),
      statusOf,
      updatedOf,
    )
    expect(result.map(({ id }) => id)).toEqual(["run-new", "run-old", "idle-new", "idle-mid", "idle-old"])
  })

  test("hidden statuses are dropped in both sort modes and never reorder survivors", () => {
    // done-hi is hidden but carries the highest updated time: if the filter
    // leaked it, it would surface in both outputs — at the top in recent
    // mode, and at the head of the non-running group in active mode.
    const rows = [
      session("run-a", 20, true),
      session("done-hi", 90, false, "succeeded"),
      session("run-b", 40, true),
      session("idle-a", 50),
    ]
    const options = resolveOptions({ show: { done: false } })
    expect(sidebarSessions(rows, options, statusOf, updatedOf).map(({ id }) => id)).toEqual([
      "idle-a",
      "run-b",
      "run-a",
    ])
    expect(
      sidebarSessions(
        rows,
        resolveOptions({ show: { done: false }, sortBy: "active" }),
        statusOf,
        updatedOf,
      ).map(({ id }) => id),
    ).toEqual(["run-b", "run-a", "idle-a"])
  })
})

describe("subagent sidebar option edges", () => {
  test("statuses unknown to this version default to visible", () => {
    // A newer host may add statuses (e.g. "paused"); resolveOptions cannot
    // know them, and sidebarSessions must not hide rows for them.
    const rows = [session("paused-row", 10), session("run", 20, true)]
    const status = (row) => (row.id === "paused-row" ? "paused" : row.running ? "running" : "idle")
    const options = resolveOptions({ show: { running: false } })
    const result = sidebarSessions(rows, options, status, updatedOf)
    expect(result.map(({ id }) => id)).toEqual(["paused-row"])
  })

  test("hide ignores unknown and non-string entries", () => {
    const options = resolveOptions({ hide: ["bogus", 42, null, "idle"] })
    expect(options.show.idle).toBe(false)
    expect(options.show.running).toBe(true)
    expect(options.show.done).toBe(true)
  })

  test("sidebarSessions never mutates its input array", () => {
    const rows = [
      session("idle-a", 30),
      session("run", 10, true),
      session("idle-b", 20),
    ]
    const before = rows.map(({ id }) => id)
    sidebarSessions(rows, resolveOptions({ sortBy: "active" }), statusOf, updatedOf)
    sidebarSessions(rows, resolveOptions(undefined), statusOf, updatedOf)
    expect(rows.map(({ id }) => id)).toEqual(before)
  })

  test("equal update times keep input order in both sort modes", () => {
    const rows = [session("first", 50), session("second", 50), session("third", 50)]
    expect(
      sidebarSessions(rows, resolveOptions({ sortBy: "active" }), statusOf, updatedOf).map(({ id }) => id),
    ).toEqual(["first", "second", "third"])
    expect(
      sidebarSessions(rows, resolveOptions(undefined), statusOf, updatedOf).map(({ id }) => id),
    ).toEqual(["first", "second", "third"])
  })
})
