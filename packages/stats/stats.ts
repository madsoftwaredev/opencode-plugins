type Model = { readonly id: string; readonly providerID: string; readonly variant?: string }

type Message = {
  readonly type: string
  readonly model?: Model
  readonly time?: { readonly created?: number; readonly streamed?: number; readonly completed?: number }
  readonly tokens?: { readonly output?: number; readonly reasoning?: number }
}

export type Stat = "speed" | "turns" | "steps"
export type StatSettings = Record<Stat, boolean>
export type Summary = { readonly id: string; readonly type: string }
export type Counts = { readonly turns: number; readonly steps: number }

type Page = { readonly data: readonly Summary[]; readonly cursor: { readonly next?: string | null } }

/** Cursor requests inherit the first page's order; the API rejects both together. */
export function messagePageInput(sessionID: string, cursor?: string) {
  return cursor
    ? { sessionID, limit: 200, cursor }
    : { sessionID, limit: 200, order: "desc" as const }
}

/** Reads the three independently configurable footer stats. */
export function readSettings(options: Readonly<Record<string, unknown>>): StatSettings {
  const enabled = (key: Stat): boolean => {
    const value = options[key]
    if (value === undefined) return true
    if (typeof value !== "boolean") throw new TypeError(`opencode-stats: ${key} must be a boolean`)
    return value
  }

  return { speed: enabled("speed"), turns: enabled("turns"), steps: enabled("steps") }
}

/** Saved TUI choices override configured startup defaults. */
export function effectiveSettings(defaults: StatSettings, overrides: Partial<StatSettings>): StatSettings {
  return {
    speed: typeof overrides.speed === "boolean" ? overrides.speed : defaults.speed,
    turns: typeof overrides.turns === "boolean" ? overrides.turns : defaults.turns,
    steps: typeof overrides.steps === "boolean" ? overrides.steps : defaults.steps,
  }
}

/** Count session turns (execution groups) and assistant steps in chronological order. */
export function countStats(messages: readonly Pick<Summary, "type">[]): Counts {
  const legacyTurns = !messages.some((message) => message.type === "idle")
  let turns = 0
  let steps = 0
  let active = false

  for (const message of messages) {
    if (message.type === "idle") {
      active = false
      continue
    }
    if (message.type === "user" || message.type === "synthetic") {
      if (!active || legacyTurns) turns += 1
      active = true
    }
    if (message.type === "assistant") steps += 1
  }

  return { turns, steps }
}

/** Load the whole history once, then fetch only pages newer than a known message. */
export async function loadSummaries(
  fetchPage: (cursor?: string) => Promise<Page>,
  previous?: readonly Summary[],
): Promise<Summary[]> {
  const known = new Set(previous?.map((message) => message.id))
  const fetched: Summary[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  let overlap = false

  do {
    const page = await fetchPage(cursor)
    fetched.push(...page.data.map(({ id, type }) => ({ id, type })))
    overlap = page.data.some((message) => known.has(message.id))
    const next = page.cursor.next ?? undefined
    if (!next || overlap) break
    if (cursors.has(next)) throw new Error("opencode-stats: repeated message cursor")
    cursors.add(next)
    cursor = next
  } while (true)

  fetched.reverse()
  if (!previous || !overlap) return fetched

  const ids = new Set(fetched.map((message) => message.id))
  return [...previous.filter((message) => !ids.has(message.id)), ...fetched]
}

function sameModel(left: Model, right: Model): boolean {
  return left.providerID === right.providerID && left.id === right.id && left.variant === right.variant
}

/** Returns OpenCode's turn-wide token rate for the latest completed assistant step. */
export function latestSpeed(messages: readonly Message[], selectedModel?: Model): number | undefined {
  let model = selectedModel
  if (!model) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].type !== "assistant") continue
      model = messages[index].model
      break
    }
  }
  if (!model) return undefined

  let latest = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type !== "assistant" || !message.model || !sameModel(message.model, model)) continue
    if (message.time?.completed === undefined) continue
    latest = index
    break
  }
  if (latest < 0) return undefined

  // With idle messages, queued user inputs still belong to the same execution.
  const legacyTurns = !messages.some((message) => message.type === "idle")
  let start = -1
  for (let index = latest; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type === "idle") break
    if (message.type !== "user" && message.type !== "synthetic") continue
    start = index
    if (legacyTurns) break
  }

  let tokens = 0
  let duration = 0
  for (let index = start + 1; index <= latest; index += 1) {
    const message = messages[index]
    if (message.type !== "assistant") continue

    const created = message.time?.created
    const streamed = message.time?.streamed
    const output = message.tokens?.output ?? 0
    const reasoning = message.tokens?.reasoning ?? 0
    if (created === undefined || streamed === undefined) return undefined
    if (![created, streamed, output, reasoning].every(Number.isFinite)) return undefined
    if (output < 0 || reasoning < 0) return undefined

    tokens += output + reasoning
    duration += Math.max(0, streamed - created)
  }

  if (tokens <= 0 || duration <= 0 || !Number.isFinite(tokens) || !Number.isFinite(duration)) return undefined
  return tokens / (duration / 1000)
}

export function formatSpeed(speed: number | undefined): string {
  return speed === undefined || !Number.isFinite(speed) || speed <= 0
    ? "— tok/s"
    : `${speed.toFixed(1)} tok/s`
}

export function formatStats(settings: StatSettings, counts: Counts | undefined, speed: number | undefined): string {
  const parts: string[] = []
  if (settings.speed) parts.push(formatSpeed(speed))
  if (settings.turns) parts.push(`${counts?.turns ?? "—"} turns`)
  if (settings.steps) parts.push(`${counts?.steps ?? "—"} steps`)
  return parts.join(" · ")
}
