import { afterAll, afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "./index";

const summary = `## Objective
Fix the callback.
## Requirements
Preserve existing sessions.
## Decisions
Use the existing handler.
## Work State
### Completed
Reproduced the failure.
### Active
Update the handler.
### Blocked
None.
## Next Move
Run the callback regression test.
## Relevant Files
src/callback.ts
## Important Context
The callback must be idempotent.`;

let requests;
let responses;
let fetchMock;
let warning;
let info;
let logRoot;
const originalDataHome = process.env.XDG_DATA_HOME;

beforeAll(async () => {
  const temporary = join(tmpdir(), "opencode");
  await mkdir(temporary, { recursive: true });
  logRoot = await mkdtemp(join(temporary, "compaction-log-test-"));
  process.env.XDG_DATA_HOME = logRoot;
});

afterAll(async () => {
  if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalDataHome;
  await rm(logRoot, { recursive: true, force: true });
});

beforeEach(() => {
  requests = [];
  responses = [];
  warning = spyOn(console, "warn").mockImplementation(() => {});
  info = spyOn(console, "info").mockImplementation(() => {});
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    if (!options.headers.get("x-opencode-session")) {
      return new Response("missing x-opencode-session", { status: 503 });
    }
    if (
      url.includes("/inference/go/") &&
      !["Bearer TEST_ACCESS", "Bearer TEST_CONSOLE_KEY"].includes(options.headers.get("authorization"))
    ) {
      return new Response("legacy Go key is not a Console credential", { status: 401 });
    }
    return responses.shift() ?? completion(summary);
  });
});

afterEach(() => {
  fetchMock.mockRestore();
  warning.mockRestore();
  info.mockRestore();
});

function completion(text, finish = "stop") {
  return Response.json({ choices: [{ finish_reason: finish, message: { content: text } }] });
}

async function setup(
  options = {},
  generate = async () => ({ text: summary }),
  providerIntegrationID = "opencode-go",
  // Console-routed Go uses opencode's OAuth connection, not the legacy Go key.
  credentials = { "opencode-go": { type: "key", key: "TEST_SECRET" }, opencode: { type: "oauth", access: "TEST_ACCESS" } }
) {
  let callback;
  const activeCalls = [];
  const ctx = {
    app: { version: "2.1.0" },
    options,
    model: {
      async list() {
        return {
          data: [
            {
              providerID: "opencode-go",
              id: "deepseek-v4.1-flash",
              modelID: "deepseek-v4.1-flash",
              enabled: true,
              package: "@opencode/ai/providers/openai-compatible",
              settings: {
                baseURL: providerIntegrationID === "opencode"
                  ? "https://opencode.ai/inference/go/openai/v1"
                  : "https://opencode.ai/zen/go/v1",
              },
              headers: { "x-opencode-org-id": "test-org" },
              variants: [{ id: "max", settings: { reasoningEffort: "max" } }],
              limit: { context: 1_000_000, output: 384_000 },
            },
          ],
        };
      },
    },
    provider: {
      async get() {
        return { data: providerIntegrationID === null ? {} : { integrationID: providerIntegrationID } };
      },
    },
    integration: {
      connection: {
        async active(integrationID) {
          activeCalls.push(integrationID);
          if (!(integrationID in credentials)) return undefined;
          return { type: "credential", id: `${integrationID}-credential` };
        },
        async resolve(connection) {
          if (!connection) return undefined;
          return credentials[connection.id.replace(/-credential$/, "")];
        },
      },
    },
    generate: { text: generate },
    session: {
      async hook(name, handler) {
        expect(name).toBe("compaction");
        callback = handler;
        return { async dispose() {} };
      },
    },
  };
  await plugin.setup(ctx);
  return Object.assign(callback, { activeCalls });
}

function event(sessionID = "ses_test") {
  return {
    sessionID,
    agent: "build",
    model: { providerID: "openai", id: "gpt-6-astra" },
    system: [{ type: "text", text: "Original instructions" }],
    messages: [{ role: "user", content: [{ type: "text", text: "Fix src/callback.ts" }] }],
    tools: {},
    options: {},
  };
}

test("Claude Code compaction is left to its bridge instead of installing an external checkpoint", async () => {
  const hook = await setup();
  const input = event();
  input.model = { providerID: "claude-code", id: "claude-opus-5-5[1m]", variant: "max" };
  await hook(input);
  expect(input.result).toBeUndefined();
  expect(requests).toHaveLength(0);
  expect(input.model).toEqual({
    providerID: "claude-code",
    id: "claude-opus-5-5[1m]",
    variant: "max",
  });
});

test("Go summary uses the originating session, configured model and variant without changing the main model", async () => {
  const hook = await setup();
  const input = event();
  await hook(input);
  expect(input.result.summary).toBe(summary);
  expect(input.result.metadata.compactionModel).toBe("opencode-go/deepseek-v4.1-flash#max");
  expect(input.model).toEqual({ providerID: "openai", id: "gpt-6-astra" });
  expect(requests[0].headers.get("x-opencode-session")).toBe("ses_test");
  expect(requests[0].headers.get("authorization")).toBe("Bearer TEST_SECRET");
  expect(requests[0].body.model).toBe("deepseek-v4.1-flash");
  expect(requests[0].body.reasoning_effort).toBe("max");
  expect(requests[0].body.tools).toBeUndefined();
});

test("Console-routed Go uses the declared OAuth integration instead of the legacy Go key", async () => {
  const hook = await setup({}, async () => ({ text: summary }), "opencode");
  const input = event();
  await hook(input);
  expect(hook.activeCalls).toEqual(["opencode"]);
  expect(input.result.summary).toBe(summary);
  expect(requests[0].url).toBe("https://opencode.ai/inference/go/openai/v1/chat/completions");
  expect(requests[0].headers.get("authorization")).toBe("Bearer TEST_ACCESS");
  expect(requests[0].headers.get("x-opencode-org-id")).toBe("test-org");
  expect(requests[0].headers.get("x-opencode-session")).toBe(input.sessionID);
  expect(requests[0].body.reasoning_effort).toBe("max");
});

test("the declared integration also supports service-account keys", async () => {
  const hook = await setup(
    {},
    async () => ({ text: summary }),
    "opencode",
    { opencode: { type: "key", key: "TEST_CONSOLE_KEY" } }
  );
  const input = event();
  await hook(input);
  expect(hook.activeCalls).toEqual(["opencode"]);
  expect(input.result.summary).toBe(summary);
  expect(requests[0].headers.get("authorization")).toBe("Bearer TEST_CONSOLE_KEY");
});

test("providers without an integration ID use their own integration", async () => {
  const hook = await setup({}, async () => ({ text: summary }), null);
  const input = event();
  await hook(input);
  expect(hook.activeCalls).toEqual(["opencode-go"]);
  expect(input.result.summary).toBe(summary);
});

test("a missing Console connection never borrows the unrelated legacy Go key", async () => {
  const hook = await setup(
    {},
    async () => ({ text: summary }),
    "opencode",
    { "opencode-go": { type: "key", key: "TEST_SECRET" } }
  );
  const input = event();
  await hook(input);
  expect(hook.activeCalls).toEqual(["opencode"]);
  expect(input.result).toBeUndefined();
  expect(requests).toHaveLength(0);
  expect(warning.mock.calls.flat().join(" ")).toContain("Connect the integration serving");
});

test("long transcripts retain the middle and attachment descriptors", async () => {
  const hook = await setup();
  const input = event();
  input.messages[0].content = [
    { type: "text", text: `${"a".repeat(100_000)} MIDDLE_DECISION ${"z".repeat(100_000)}` },
    { type: "media", mediaType: "image/png", filename: "design.png", data: "BINARY_PAYLOAD" },
  ];
  await hook(input);
  const prompt = requests[0].body.messages[0].content;
  expect(prompt).toContain("MIDDLE_DECISION");
  expect(prompt).toContain("design.png");
  expect(prompt).not.toContain("BINARY_PAYLOAD");
  expect(input.result.summary).toBe(summary);
});

test("concurrent compactions keep their own session routing headers", async () => {
  const hook = await setup();
  const first = event("ses_first");
  const second = event("ses_second");
  await Promise.all([hook(first), hook(second)]);
  expect(requests.map((request) => request.headers.get("x-opencode-session")).sort()).toEqual([
    "ses_first",
    "ses_second",
  ]);
  expect(first.result.summary).toBe(summary);
  expect(second.result.summary).toBe(summary);
});

test("provider rejection warns about fallback without logging its body or credentials", async () => {
  responses.push(new Response("TEST_SECRET private transcript", { status: 503 }));
  const input = event();
  await (
    await setup()
  )(input);
  expect(input.result).toBeUndefined();
  const log = warning.mock.calls.flat().join(" ");
  expect(log).toContain("HTTP 503");
  expect(log).toContain("Falling back");
  expect(log).not.toContain("TEST_SECRET");
  expect(log).not.toContain("private transcript");
  const diagnostics = await readFile(join(logRoot, "opencode/log/compaction-model.log"), "utf8");
  expect(diagnostics).toContain("HTTP 503");
  expect(diagnostics).not.toContain("TEST_SECRET");
});

test("a rejected Console OAuth request falls back without leaking the access token", async () => {
  const hook = await setup({}, async () => ({ text: summary }), "opencode");
  responses.push(new Response("TEST_ACCESS private transcript", { status: 401 }));
  const input = event();
  await hook(input);
  expect(input.result).toBeUndefined();
  expect(requests).toHaveLength(1);
  expect(requests[0].headers.get("authorization")).toBe("Bearer TEST_ACCESS");
  const log = warning.mock.calls.flat().join(" ");
  expect(log).toContain("HTTP 401");
  expect(log).toContain("Falling back");
  expect(log).not.toContain("TEST_ACCESS");
  expect(log).not.toContain("private transcript");
  const diagnostics = await readFile(join(logRoot, "opencode/log/compaction-model.log"), "utf8");
  expect(diagnostics).not.toContain("TEST_ACCESS");
});

test("invalid headings trigger one retry with the original transcript", async () => {
  responses.push(completion("## Unrelated\nNot a checkpoint."), completion(summary));
  const input = event();
  await (
    await setup()
  )(input);
  expect(requests).toHaveLength(2);
  expect(requests[1].body.messages[0].content).toContain("Fix src/callback.ts");
  expect(input.result.summary).toBe(summary);
});

test("a second invalid summary or token-truncated completion is never installed", async () => {
  const hook = await setup();
  responses.push(completion("## Wrong"), completion(""));
  const empty = event();
  await hook(empty);
  expect(empty.result).toBeUndefined();
  responses.push(completion(summary, "length"));
  const truncated = event();
  await hook(truncated);
  expect(truncated.result).toBeUndefined();
  expect(warning).toHaveBeenCalledTimes(2);
});

test("an explicit transcript budget refuses loss rather than slicing out history", async () => {
  const input = event();
  await (
    await setup({ maxTranscriptChars: 10 })
  )(input);
  expect(requests).toHaveLength(0);
  expect(input.result).toBeUndefined();
  expect(warning.mock.calls.flat().join(" ")).toContain("refusing to discard history");
});

test("other providers keep using the native text-generation API", async () => {
  let selected;
  const hook = await setup({ model: "acme/custom-model#low" }, async (request) => {
    selected = request.model;
    return { text: summary };
  });
  const input = event();
  await hook(input);
  expect(selected).toEqual({ providerID: "acme", id: "custom-model", variant: "low" });
  expect(input.result.summary).toBe(summary);
  expect(requests).toHaveLength(0);
});

test("unexpected native generation errors do not leak response data to logs", async () => {
  const hook = await setup({ model: "acme/custom-model" }, async () => {
    throw new Error("TEST_SECRET private transcript");
  });
  const input = event();
  await hook(input);
  expect(input.result).toBeUndefined();
  expect(warning.mock.calls.flat().join(" ")).not.toContain("TEST_SECRET");
});

test("an existing plugin result is preserved and malformed model options are rejected", async () => {
  const input = { ...event(), result: { summary: "Existing checkpoint" } };
  await (
    await setup()
  )(input);
  expect(input.result.summary).toBe("Existing checkpoint");
  expect(requests).toHaveLength(0);
  await expect(setup({ model: "missing-provider" })).rejects.toThrow("provider/model");
});
