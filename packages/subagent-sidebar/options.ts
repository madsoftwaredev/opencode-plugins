export const STATUSES = ["running", "idle", "done", "failed", "stopped"] as const
export type Status = (typeof STATUSES)[number]

export type SortMode = "active" | "recent"

export type SidebarOptions = {
  readonly show: Record<Status, boolean>
  readonly sortBy: SortMode
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Resolve user-provided options (the plugin `options` object from the host)
 * into a fully-populated configuration. Unknown keys are ignored; invalid
 * values fall back to defaults. Defaults match prior behavior: every
 * status visible, most-recent-activity order.
 */
export function resolveOptions(raw: unknown): SidebarOptions {
  const source = isRecord(raw) ? raw : {}

  const show: Record<Status, boolean> = {
    running: true,
    idle: true,
    done: true,
    failed: true,
    stopped: true,
  }

  if (isRecord(source.show)) {
    for (const status of STATUSES) {
      const value = source.show[status]
      if (typeof value === "boolean") show[status] = value
    }
  }

  if (Array.isArray(source.hide)) {
    for (const status of source.hide) {
      if ((STATUSES as readonly string[]).includes(String(status))) {
        show[status as Status] = false
      }
    }
  }

  const sortBy: SortMode = source.sortBy === "active" ? "active" : "recent"

  return { show, sortBy }
}

/**
 * Apply visibility and ordering to a list of sessions. `statusOf` and
 * `updatedOf` read live session state, keeping this function pure and unit
 * testable. With `sortBy: "active"`, running sessions come first; recency
 * (most recently updated) is the secondary key within both groups.
 *
 * Only an explicit `false` hides a status: statuses that do not exist in
 * this version (e.g. one added by a newer host) have no entry in `show` and
 * therefore render visible, so forward additions are never silently hidden.
 */
export function sidebarSessions<S>(
  sessions: readonly S[],
  options: SidebarOptions,
  statusOf: (session: S) => Status,
  updatedOf: (session: S) => number,
): S[] {
  const visible = sessions.filter((session) => options.show[statusOf(session)] !== false)
  if (options.sortBy === "active") {
    return [...visible].sort(
      (left, right) =>
        Number(statusOf(right) === "running") - Number(statusOf(left) === "running") ||
        updatedOf(right) - updatedOf(left),
    )
  }
  return [...visible].sort((left, right) => updatedOf(right) - updatedOf(left))
}
