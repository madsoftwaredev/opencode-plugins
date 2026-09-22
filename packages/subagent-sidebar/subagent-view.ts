export type SubagentSession = {
  id: string
  parentID?: string
  agent?: string
  title?: string
  outcome?: "succeeded" | "failed" | "interrupted"
  time: { updated: number }
}

export type SubagentStatus = "running" | "idle" | "done" | "failed" | "stopped"

export function descendantSessions(sessions: readonly SubagentSession[], rootID: string): SubagentSession[] {
  const children = new Map<string, SubagentSession[]>()

  for (const session of sessions) {
    if (!session.parentID) continue
    const siblings = children.get(session.parentID) ?? []
    siblings.push(session)
    children.set(session.parentID, siblings)
  }

  const descendants: SubagentSession[] = []
  const pending = [...(children.get(rootID) ?? [])]

  while (pending.length > 0) {
    const session = pending.shift()
    if (!session) continue

    descendants.push(session)
    pending.push(...(children.get(session.id) ?? []))
  }

  return descendants.sort((left, right) => right.time.updated - left.time.updated)
}

export function subagentStatus(
  session: Pick<SubagentSession, "outcome">,
  activity: "idle" | "running",
): SubagentStatus {
  if (activity === "running") return "running"
  if (session.outcome === "succeeded") return "done"
  if (session.outcome === "failed") return "failed"
  if (session.outcome === "interrupted") return "stopped"
  return "idle"
}

export function shorten(value: string, maxLength = 52): string {
  const text = value.replace(/\s+/g, " ").trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function toolInputSummary(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined

  const keys = ["path", "filePath", "command", "cmd", "query", "pattern", "url", "description", "prompt"]
  for (const key of keys) {
    const value = stringValue(input[key])
    if (value) return shorten(value, 32)
  }

  return undefined
}

function latestUserText(messages: readonly unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || message.type !== "user") continue
    const text = stringValue(message.text)
    if (text) return shorten(text)
  }

  return undefined
}

function latestAssistantActivity(messages: readonly unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || message.type !== "assistant" || !Array.isArray(message.content)) continue

    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex]
      if (!isRecord(part)) continue

      if (part.type === "tool" && isRecord(part.state)) {
        const state = part.state.status
        if (state === "running" || state === "streaming") {
          const name = stringValue(part.name) ?? "tool"
          const input = toolInputSummary(part.state.input)
          return shorten(input ? `${name} · ${input}` : `Using ${name}`)
        }
      }

      if (part.type === "text" || part.type === "reasoning") {
        const text = stringValue(part.text)
        if (text) return shorten(text)
      }
    }
  }

  return undefined
}

export function subagentTask(messages: readonly unknown[], activity: "idle" | "running"): string {
  if (activity === "running") {
    const current = latestAssistantActivity(messages)
    if (current) return current
  }

  return latestUserText(messages) ?? latestAssistantActivity(messages) ?? "Waiting for work"
}
