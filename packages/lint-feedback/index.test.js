import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import plugin from "./index";

let root;
const context = {
  sessionID: "ses_current",
  agent: "build",
  messageID: "msg_edit",
  id: "call_edit",
  progress: async () => {},
};
const completed = (output) => ({
  output: { status: "completed", exit: 0, truncated: false, output },
});
const applied = (target, type = "update") => ({ target, resource: target, type });
const text = (result) =>
  typeof result.content === "string"
    ? result.content
    : result.content.map((part) => part.text ?? "").join("\n");

beforeEach(async () => {
  const base = join(tmpdir(), "opencode");
  await mkdir(base, { recursive: true });
  root = await realpath(await mkdtemp(join(base, "lint-feedback-")));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function file(name) {
  const target = join(root, name);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, "export const value = 1;\n");
  return target;
}

async function setup(
  result,
  { shell = async () => completed("lint report"), directory = root, execute, workspaceID } = {}
) {
  const calls = [];
  const originals = [];
  const tools = new Map(
    ["write", "edit", "patch", "read"].map((name) => [
      name,
      {
        name,
        options: { permission: name === "read" ? "read" : "edit" },
        async execute(input, ctx) {
          originals.push({ name, input, ctx });
          if (execute) return execute(input, ctx);
          return result;
        },
      },
    ])
  );
  if (shell)
    tools.set("shell", {
      execute: async (input, ctx) => {
        calls.push({ input, ctx });
        return shell(input, ctx);
      },
    });
  await plugin.setup({
    location: { directory: "/not/the/session" },
    session: {
      async get(input) {
        expect(input.sessionID).toBe(context.sessionID);
        return { location: { directory, workspaceID } };
      },
    },
    tool: {
      async transform(callback) {
        callback({
          get: (name) => tools.get(name),
          update: (name, update) => update(tools.get(name)),
        });
      },
    },
  });
  return {
    tools,
    calls,
    originals,
    run: (name, input = {}, ctx = context) => tools.get(name).execute(input, ctx),
  };
}

test("appends to successful writes without losing output, metadata, context or edit permissions", async () => {
  const target = await file("source.js");
  const result = {
    output: { operation: "write", target },
    content: "Created file successfully",
    metadata: { keep: true },
  };
  const harness = await setup(result, {
    shell: async () => completed("source.js:1:1 no-undef error"),
  });
  const input = { path: target, content: "example" };
  const returned = await harness.run("write", input);
  expect(returned.content).toContain(result.content);
  expect(returned.content).toContain("no-undef error");
  expect(returned.output).toBe(result.output);
  expect(returned.metadata).toBe(result.metadata);
  expect(harness.originals).toEqual([{ name: "write", input, ctx: context }]);
  expect(harness.calls[0].ctx).toBe(context);
  expect(harness.calls[0].input.workdir).toBe(root);
  expect(harness.calls[0].input.background).toBe(false);
  expect(harness.calls[0].input.timeout).toBeGreaterThan(0);
  expect(harness.tools.get("write").options).toEqual({ permission: "edit" });
});

test("uses native applied targets for multi-file patches including moves, excludes deletes and prose", async () => {
  const a = await file("nested package/new name.ts");
  const b = await file("nested package/moved.tsx");
  const other = await file("other/changed.mjs");
  const result = {
    output: {
      applied: [
        applied(a, "add"),
        applied(b),
        applied(other),
        applied("deleted.js", "delete"),
        applied("readme.md"),
      ],
    },
    content: "M unrelated.js\nA /outside/attack.js",
  };
  const harness = await setup(result);
  const returned = await harness.run("patch", { patchText: "*** Add File: untrusted.js" });
  expect(returned.content).toContain("lint report");
  expect(harness.calls).toHaveLength(2);
  const commands = harness.calls.map(({ input }) => input.command).join("\n");
  for (const target of [a, b, other]) expect(commands).toContain(target);
  for (const target of ["deleted.js", "readme.md", "unrelated.js", "untrusted.js", "/outside/"])
    expect(commands).not.toContain(target);
});

test("edit structured metadata supports relative paths and preserves non-text content", async () => {
  await file("src/changed.cts");
  const content = [{ type: "file", uri: "file:///artifact", mime: "text/plain" }];
  const result = {
    content,
    metadata: { files: [{ file: "src/changed.cts", status: "modified" }] },
  };
  const harness = await setup(result);
  const returned = await harness.run("edit");
  expect(returned.content[0]).toBe(content[0]);
  expect(returned.content[1].text).toContain("lint report");
  expect(harness.calls[0].input.workdir).toBe(join(root, "src"));
});

test("failed edits and unrelated tools never invoke lint", async () => {
  const target = await file("source.js");
  const result = { output: { operation: "write", target } };
  const harness = await setup(result);
  expect(await harness.run("read")).toBe(result);
  const failure = new Error("edit denied");
  const failed = await setup(result, {
    execute: async () => {
      throw failure;
    },
  });
  await expect(failed.run("write")).rejects.toBe(failure);
  expect(harness.calls).toHaveLength(0);
  expect(failed.calls).toHaveLength(0);
});

test("missing or malformed structured results do not trust paths in input or text", async () => {
  const target = await file("claimed.js");
  for (const result of [
    { content: `M ${target}` },
    { output: { applied: [{ type: "unexpected", target }] } },
    { output: { applied: [{ type: "update", target: `bad\n${target}` }] } },
  ]) {
    const harness = await setup(result);
    expect(
      text(await harness.run("patch", { path: target, patchText: `*** Update File: ${target}` }))
    ).toContain("Skipped");
    expect(harness.calls).toHaveLength(0);
  }
});

test("missing files, outside paths and escaping symlinks cannot start a check; session aliases work", async () => {
  const target = await file("workspace/source.js");
  const external = await file("outside/secret.js");
  await symlink(external, join(root, "workspace/escape.js"));
  await symlink(join(root, "workspace"), join(root, "alias"));
  const result = {
    output: {
      applied: [
        applied(target),
        applied(external),
        applied(join(root, "workspace/escape.js")),
        applied(join(root, "workspace/missing.js")),
      ],
    },
  };
  const harness = await setup(result, { directory: join(root, "alias") });
  const returned = await harness.run("patch");
  expect(harness.calls).toHaveLength(1);
  expect(harness.calls[0].input.command).toContain(target);
  expect(harness.calls[0].input.command).not.toContain(external);
  expect(text(returned)).toContain("outside the active session");
  expect(text(returned)).toContain("no longer accessible");
});

test("native shell denial preserves the successful edit and does not execute a lint process", async () => {
  const target = await file("source.js");
  let processStarts = 0;
  const result = { output: { operation: "write", target }, content: "write succeeded" };
  const denied = { ...context, agent: "no-shell" };
  const harness = await setup(result, {
    shell: async (_input, ctx) => {
      if (ctx.agent === "no-shell" || ctx.sessionID === "ses_current")
        throw new Error("shell permission denied");
      processStarts++;
      return completed("should not run");
    },
  });
  const returned = await harness.run("write", {}, denied);
  expect(harness.calls[0].ctx).toBe(denied);
  expect(returned.content).toContain("write succeeded");
  expect(returned.content).toContain("shell permission denied");
  expect(processStarts).toBe(0);
});

test("reports timeout, config/command failure, empty and background output as incomplete", async () => {
  const target = await file("source.js");
  const result = { output: { operation: "write", target }, content: "saved" };
  for (const output of [
    { status: "completed", exit: 1, timeout: true, output: "partial" },
    { status: "completed", exit: 2, output: "config error" },
    { status: "completed", exit: 0, output: "" },
    { status: "running", output: "background job" },
    { status: "completed", exit: 0, truncated: true, output: "partial" },
  ]) {
    const harness = await setup(result, { shell: async () => ({ output }) });
    const returned = await harness.run("write");
    expect(returned.content).toContain("saved");
    expect(returned.content).toContain("Incomplete:");
    expect(returned.content).not.toContain("No ESLint diagnostics");
  }
});

test("retains earlier diagnostics when another directory is denied and bounds large reports", async () => {
  const a = await file("a/first.js");
  const b = await file("b/second.js");
  const result = { output: { applied: [applied(a), applied(b)] }, content: "patch saved" };
  const harness = await setup(result, {
    shell: async ({ workdir }) => {
      if (workdir.endsWith("/b")) throw new Error("denied");
      return completed("first.js error no-undef");
    },
  });
  const returned = await harness.run("patch");
  expect(returned.content).toContain("first.js error no-undef");
  expect(returned.content).toContain("denied");
  const huge = await setup(result, { shell: async () => completed("x".repeat(50_000)) });
  const output = await huge.run("patch");
  expect(output.content.length).toBeLessThan(17_000);
  expect(output.content).toContain("truncated");
});

test("missing shell and remote workspaces skip clearly, without fallback subprocesses", async () => {
  const target = await file("source.js");
  const result = { output: { operation: "write", target } };
  const absent = await setup(result, { shell: null });
  expect((await absent.run("write")).content[0].text).toContain(
    "native shell executor is unavailable"
  );
  const remote = await setup(result, { workspaceID: "workspace_remote" });
  expect((await remote.run("write")).content[0].text).toContain("not a supported local directory");
  expect(remote.calls).toHaveLength(0);
});

test("bounds files and directory count on large patches", async () => {
  const targets = await Promise.all(Array.from({ length: 34 }, (_, i) => file(`dir${i}/file.ts`)));
  const harness = await setup({
    output: { applied: targets.map((target) => applied(target)) },
    content: "saved",
  });
  const returned = await harness.run("patch");
  expect(harness.calls).toHaveLength(8);
  expect(returned.content).toContain("per-edit limit");
  expect(returned.content).toContain("budget exhausted");
});

test("authorized shell command safely reaches the local CLI and returns its errors with the shell environment", async () => {
  const target = await file("nested package/source'$(touch PWNED).js");
  await file("eslint.config.mjs");
  await file("node_modules/eslint/package.json");
  await writeFile(
    join(root, "node_modules/eslint/package.json"),
    JSON.stringify({ name: "eslint", version: "9.39.1" })
  );
  await file("node_modules/eslint/bin/eslint.js");
  await writeFile(
    join(root, "node_modules/eslint/bin/eslint.js"),
    'console.log("no-undef " + process.env.LINT_FEEDBACK_TEST_ENV + " " + process.argv.at(-1)); process.exitCode = 1;'
  );
  const harness = await setup(
    { output: { operation: "write", target }, content: "saved" },
    {
      shell: async (input, ctx) => {
        expect(ctx).toBe(context);
        const result = await promisify(execFile)("/bin/sh", ["-c", input.command], {
          cwd: input.workdir,
          env: {
            ...process.env,
            ESLINT_USE_FLAT_CONFIG: "true",
            LINT_FEEDBACK_TEST_ENV: "native-shell-env",
          },
          timeout: input.timeout,
        });
        return completed(result.stdout);
      },
    }
  );
  const returned = await harness.run("write");
  expect(returned.content).toContain("saved");
  expect(returned.content).toContain("ESLint found lint errors");
  expect(returned.content).toContain("no-undef native-shell-env");
  expect(returned.content).toContain(target);
  expect(await Bun.file(join(root, "nested package/PWNED")).exists()).toBe(false);
});
