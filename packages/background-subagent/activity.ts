import type { Context } from "@opencode/plugin/tui/context";

export type ActivitySession = ReturnType<Context["data"]["session"]["list"]>[number];
export type ActivityStatus = "running" | "pending" | "idle" | "done" | "failed" | "stopped";

export function activityStatus(
  session: ActivitySession,
  live: "running" | "idle",
  pending: number,
): ActivityStatus {
  // A resumed session still carries its previous outcome until the new run ends.
  if (live === "running") return "running";
  if (pending > 0) return "pending";
  if (session.outcome === "succeeded") return "done";
  if (session.outcome === "failed") return "failed";
  if (session.outcome === "interrupted") return "stopped";
  // Missing terminal metadata is not evidence of queued work or interruption.
  return "idle";
}

export function isActive(status: ActivityStatus): boolean {
  return status === "running" || status === "pending";
}

export function oneLine(value: string): string {
  return value.replace(/[\s\x00-\x1f\x7f-\x9f]+/g, " ").trim();
}

export function activityLabel(session: ActivitySession): string {
  const agent = oneLine(session.agent ?? "subagent") || "subagent";
  const task = oneLine(session.title ?? "");
  return task && task !== agent ? `${agent}: ${task}` : agent;
}

export const STATUS_MARKERS: Record<ActivityStatus, string> = {
  running: "●",
  pending: "○",
  idle: "○",
  done: "✓",
  failed: "×",
  stopped: "!",
};
