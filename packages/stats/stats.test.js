import assert from "node:assert/strict"
import { test } from "node:test"
import { countStats, effectiveSettings, formatSpeed, formatStats, latestSpeed, loadSummaries, messagePageInput, readSettings } from "./stats.ts"

const fast = { providerID: "example", id: "fast" }
const slow = { providerID: "example", id: "slow" }

const assistant = (model, output, reasoning, created, streamed, completed) => ({
  type: "assistant",
  model,
  tokens: { output, reasoning },
  time: { created, streamed, completed },
})

test("matches OpenCode's turn-wide rate, including reasoning and excluding the tail after streaming", () => {
  const messages = [
    { type: "user" },
    { ...assistant(fast, 40, 0, 1000, 3636, 3650), tokens: { input: 9000, output: 40, reasoning: 0 } },
    { type: "user" }, // A queued input during the same execution does not start a new turn.
    assistant(fast, 105, 1007, 4000, 27310, 27350),
    { type: "idle" },
  ]

  assert.equal(formatSpeed(latestSpeed(messages, fast)), "44.4 tok/s")
  assert.equal(formatSpeed(latestSpeed(messages.slice(0, 4))), "47.7 tok/s")
})

test("keeps the last completed speed while a new response is streaming", () => {
  const messages = [
    { type: "user" },
    assistant(fast, 40, 0, 1000, 2000, 2100),
    { type: "idle" },
    { type: "user" },
    { type: "assistant", model: fast, time: { created: 3000, streamed: 3500 } },
  ]
  assert.equal(latestSpeed(messages, fast), 40)
  assert.equal(latestSpeed([...messages.slice(0, -1), assistant(fast, 90, 0, 4000, 6000, 6100)], fast), 45)
})

test("does not show another model's speed after a model switch", () => {
  const messages = [
    { type: "user" },
    assistant(fast, 40, 0, 1000, 2000, 2100),
    { type: "idle" },
    { type: "user" },
    { type: "assistant", model: slow, time: { created: 3000, streamed: 3500 } },
  ]
  assert.equal(latestSpeed(messages), undefined)
  assert.equal(latestSpeed(messages, slow), undefined)
  assert.equal(latestSpeed([...messages.slice(0, -1), assistant(slow, 60, 0, 4000, 6000, 6100)], slow), 30)
})

test("resets the rate at the next turn and leaves incomplete measurements empty", () => {
  const messages = [
    { type: "user" },
    assistant(fast, 20, 0, 1000, 2000, 2100),
    { type: "idle" },
    { type: "synthetic" },
    assistant(fast, 80, 0, 4000, 6000, 6100),
  ]
  assert.equal(latestSpeed(messages), 40)
  assert.equal(latestSpeed([]), undefined)
  assert.equal(latestSpeed([assistant(fast, 0, 0, 1000, 2000, 2100)]), undefined)
  assert.equal(latestSpeed([assistant(fast, 20, 0, 1000, 1000, 1100)]), undefined)
  assert.equal(latestSpeed([assistant(fast, -1, 0, 1000, 2000, 2100)]), undefined)
  assert.equal(latestSpeed([assistant(fast, 20, 0, 1000, undefined, 2100)]), undefined)
  assert.equal(formatSpeed(undefined), "— tok/s")
  assert.equal(formatSpeed(0), "— tok/s")
  assert.equal(formatSpeed(42.4), "42.4 tok/s")
})

test("counts total execution turns and assistant steps, including a running turn", () => {
  const messages = [
    { type: "user" },
    { type: "assistant" },
    { type: "synthetic" },
    { type: "assistant" },
    { type: "idle" },
    { type: "user" },
    { type: "assistant" },
    { type: "user" },
    { type: "assistant" },
    { type: "idle" },
    { type: "synthetic" },
  ]
  assert.deepEqual(countStats(messages), { turns: 3, steps: 4 })
  assert.deepEqual(countStats(messages.filter((message) => message.type !== "idle")), { turns: 5, steps: 4 })
  assert.deepEqual(countStats([]), { turns: 0, steps: 0 })
})

test("paginates full session counts and incrementally merges updated recent messages", async () => {
  const pages = {
    first: { data: [{ id: "6", type: "idle" }, { id: "5", type: "assistant" }, { id: "4", type: "user" }], cursor: { next: "older" } },
    older: { data: [{ id: "3", type: "idle" }, { id: "2", type: "assistant" }, { id: "1", type: "user" }], cursor: {} },
  }
  const initial = await loadSummaries((cursor) => Promise.resolve(cursor ? pages.older : pages.first))
  assert.deepEqual(countStats(initial), { turns: 2, steps: 2 })

  const calls = []
  const updated = await loadSummaries((cursor) => {
    calls.push(cursor)
    return Promise.resolve({
      data: [{ id: "8", type: "assistant" }, { id: "7", type: "user" }, { id: "6", type: "idle" }],
      cursor: { next: "older" },
    })
  }, initial)
  assert.deepEqual(calls, [undefined])
  assert.deepEqual(updated.map((message) => message.id), ["1", "2", "3", "4", "5", "6", "7", "8"])
  assert.deepEqual(countStats(updated), { turns: 3, steps: 3 })

  const replaced = await loadSummaries(
    () => Promise.resolve({ data: [{ id: "9", type: "user" }], cursor: {} }),
    updated,
  )
  assert.deepEqual(countStats(replaced), { turns: 1, steps: 0 })
})

test("cursor pages omit order, as required by the message-list API", () => {
  assert.deepEqual(messagePageInput("session"), { sessionID: "session", limit: 200, order: "desc" })
  assert.deepEqual(messagePageInput("session", "next-page"), { sessionID: "session", limit: 200, cursor: "next-page" })
})

test("config defaults, saved TUI overrides, and inline formatting work independently", () => {
  const defaults = readSettings({ speed: false, steps: true })
  assert.deepEqual(defaults, { speed: false, turns: true, steps: true })
  assert.throws(() => readSettings({ turns: "off" }), /turns must be a boolean/)
  const saved = effectiveSettings(defaults, { speed: true, turns: false })
  assert.equal(formatStats(saved, { turns: 3, steps: 8 }, 44.4), "44.4 tok/s · 8 steps")
  assert.equal(formatStats(readSettings({}), undefined, undefined), "— tok/s · — turns · — steps")
  assert.equal(formatStats({ speed: false, turns: false, steps: false }, undefined, undefined), "")
})
