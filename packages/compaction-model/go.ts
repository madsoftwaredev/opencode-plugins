import type { Plugin } from "@opencode/plugin";

type Context = Parameters<Plugin.Plugin["setup"]>[0];
type ModelRef = { providerID: string; id: string; variant?: string };

/** Only these controlled messages are safe to include in the diagnostic log. */
export class CompactionError extends Error {}

/** Go requires the real session ID; the V2 stateless generate API omits it. */
export async function generateGoSummary(
  ctx: Context,
  model: ModelRef,
  sessionID: string,
  prompt: string
): Promise<string> {
  const catalog = await ctx.model.list();
  const selected = catalog.data.find(
    (candidate) => candidate.providerID === model.providerID && candidate.id === model.id
  );
  if (!selected || !selected.enabled) throw new CompactionError("Compaction model is unavailable.");
  if (selected.package !== "@opencode/ai/providers/openai-compatible") {
    throw new CompactionError(
      "The Go compaction adapter requires an OpenAI-compatible chat model."
    );
  }

  const variant = selected.variants.find((candidate) => candidate.id === model.variant);
  if (model.variant && !variant)
    throw new CompactionError("Compaction model variant is unavailable.");
  const settings = { ...selected.settings, ...variant?.settings };
  if (typeof settings.baseURL !== "string")
    throw new CompactionError("Go endpoint is unavailable.");

  const provider = await ctx.provider.get({ providerID: model.providerID });
  const connection = await ctx.integration.connection.active(
    provider.data.integrationID ?? model.providerID
  );
  const credential = connection ? await ctx.integration.connection.resolve(connection) : undefined;
  if (credential?.type !== "key")
    throw new CompactionError("Connect an OpenCode Go API key first.");

  const headers = new Headers({ ...selected.headers, ...variant?.headers });
  headers.set("authorization", `Bearer ${credential.key}`);
  headers.set("content-type", "application/json");
  headers.set("user-agent", `opencode/${ctx.app.version}`);
  headers.set("x-opencode-session", sessionID);

  let response: Response;
  try {
    response = await fetch(`${settings.baseURL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        ...selected.body,
        ...variant?.body,
        model: selected.modelID,
        messages: [{ role: "user", content: prompt }],
        reasoning_effort: settings.reasoningEffort,
        max_tokens: Math.min(selected.limit.output || 32_768, 32_768),
        stream: false,
      }),
    });
  } catch {
    // Transport errors can contain request data. Keep credentials/transcripts out of logs.
    throw new CompactionError("Go compaction request failed or timed out.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new CompactionError(`Go compaction returned HTTP ${response.status}.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CompactionError("Go returned invalid JSON for the compaction summary.");
  }
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new CompactionError("Go returned an invalid completion response.");
  }
  const choice: unknown = payload.choices[0];
  if (!isRecord(choice) || choice.finish_reason !== "stop" || !isRecord(choice.message)) {
    throw new CompactionError("Go did not finish the compaction summary.");
  }
  if (typeof choice.message.content !== "string" || !choice.message.content.trim()) {
    throw new CompactionError("Go returned an empty compaction summary.");
  }
  return choice.message.content.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
