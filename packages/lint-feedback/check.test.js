import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkFiles, selectProject } from "./check.mjs";

let root;
let flatConfigEnv;
beforeEach(async () => {
  flatConfigEnv = process.env.ESLINT_USE_FLAT_CONFIG;
  delete process.env.ESLINT_USE_FLAT_CONFIG;
  const base = join(tmpdir(), "opencode");
  await mkdir(base, { recursive: true });
  root = await realpath(await mkdtemp(join(base, "lint-check-")));
});
afterEach(async () => {
  if (flatConfigEnv === undefined) delete process.env.ESLINT_USE_FLAT_CONFIG;
  else process.env.ESLINT_USE_FLAT_CONFIG = flatConfigEnv;
  await rm(root, { recursive: true, force: true });
});

async function file(name, content = "export const value = 1;\n") {
  const target = join(root, name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}

async function project(prefix = "", version = "9.39.1") {
  await file(join(prefix, "eslint.config.mjs"), "export default [];\n");
  await file(
    join(prefix, "node_modules/eslint/package.json"),
    JSON.stringify({ name: "eslint", version })
  );
  await file(join(prefix, "node_modules/eslint/bin/eslint.js"), "");
}

test("chooses nearest package install and flat config, including nested and hoisted dependencies", async () => {
  await project();
  await project("packages/nested", "10.0.0");
  const nested = await file("packages/nested/src/source.ts");
  const hoisted = await file("packages/hoisted/src/source.ts");
  await file("packages/hoisted/eslint.config.js", "export default [];\n");
  expect(await selectProject(root, nested)).toMatchObject({
    binary: join(root, "packages/nested/node_modules/eslint/bin/eslint.js"),
    config: join(root, "packages/nested/eslint.config.mjs"),
    cwd: join(root, "packages/nested"),
  });
  expect(await selectProject(root, hoisted)).toMatchObject({
    binary: join(root, "node_modules/eslint/bin/eslint.js"),
    config: join(root, "packages/hoisted/eslint.config.js"),
  });
});

test("never searches above the active directory or uses global/legacy ESLint", async () => {
  await project();
  const target = await file("isolated/source.js");
  const report = await checkFiles(join(root, "isolated"), [target], () => {
    throw new Error("must not execute");
  });
  expect(report).toContain("Skipped");
  expect(report).toContain("no flat eslint.config");
  await project("isolated", "8.0.0");
  expect((await selectProject(root, target)).skip).toContain("ESLint 9/10");
  await rm(join(root, "isolated/node_modules"), { recursive: true });
  const uninstalled = await checkFiles(join(root, "isolated"), [target]);
  expect(uninstalled).toContain("no project-installed ESLint");
});

test("checks only explicit regular files with project rules and literal argv, never --fix or repository globs", async () => {
  await project();
  const a = await file("src/space name.js");
  const b = await file("src/quote'$(touch nope);[x].tsx");
  const calls = [];
  const report = await checkFiles(root, [a, b], async (executable, args, options) => {
    calls.push({ executable, args, options });
    return { stdout: "1:1 error 'missing' is not defined no-undef", stderr: "" };
  });
  expect(report).toContain("no-undef");
  expect(calls).toHaveLength(1);
  expect(calls[0].args.slice(-3)).toEqual(["--", a, b]);
  expect(calls[0].args).toContain("--no-config-lookup");
  expect(calls[0].args).not.toContain("--fix");
  expect(calls[0].args).not.toContain(".");
  expect(calls[0].options.cwd).toBe(root);
  expect(calls[0].options.env).toBeUndefined();
  expect(calls[0].options.timeout).toBeGreaterThan(0);
  expect(calls[0].options.maxBuffer).toBe(64 * 1024);
});

test("ignores missing files, directories, unsupported extensions and external symlinks", async () => {
  await project("workspace");
  const outside = await file("outside.js");
  const workspace = join(root, "workspace");
  await symlink(outside, join(workspace, "escape.js"));
  await mkdir(join(workspace, "directory.js"));
  const md = await file("workspace/readme.md");
  let ran = false;
  const result = await checkFiles(
    workspace,
    [
      outside,
      join(workspace, "escape.js"),
      join(workspace, "missing.js"),
      join(workspace, "directory.js"),
      md,
    ],
    async () => {
      ran = true;
    }
  );
  expect(ran).toBe(false);
  expect(result).toContain("outside the active directory");
  expect(result).toContain("Symlink leaves");
  expect(result).toContain("no longer exists");
  expect(result).toContain("Not a regular file");
  expect(result).toContain("not a JS/TS");
});

test("does not follow config or install symlinks outside the workspace, permits internal pnpm-style links", async () => {
  await project("outside");
  const target = await file("workspace/source.js");
  await symlink(join(root, "outside/eslint.config.mjs"), join(root, "workspace/eslint.config.mjs"));
  await expect(selectProject(join(root, "workspace"), target)).rejects.toThrow("Symlink leaves");
  await rm(join(root, "workspace/eslint.config.mjs"));
  await file("workspace/eslint.config.mjs", "export default [];\n");
  await symlink(join(root, "outside/node_modules"), join(root, "workspace/node_modules"));
  await expect(selectProject(join(root, "workspace"), target)).rejects.toThrow("Symlink leaves");
  expect((await selectProject(root, target)).binary).toBe(
    join(root, "outside/node_modules/eslint/bin/eslint.js")
  );
});

test("distinguishes clean, ignored/warnings, lint errors, configuration failure and interrupted checks", async () => {
  await project();
  const target = await file("source.js");
  expect(await checkFiles(root, [target], async () => ({ stdout: "", stderr: "" }))).toContain(
    "No ESLint diagnostics"
  );
  const ignored = await checkFiles(root, [target], async () => ({
    stdout: "File ignored because no matching configuration was supplied",
    stderr: "",
  }));
  expect(ignored).toContain("ignored");
  expect(ignored).not.toContain("No ESLint diagnostics");
  for (const [error, expected] of [
    [{ code: 1, stdout: "1:1 no-undef", stderr: "" }, "lint errors"],
    [{ code: 2, stderr: "config failed" }, "configuration/execution error"],
    [{ killed: true, signal: "SIGKILL", stdout: "partial" }, "timed out or was terminated"],
    [{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stdout: "partial" }, "output limit exceeded"],
  ]) {
    const report = await checkFiles(root, [target], async () => {
      throw Object.assign(new Error("failed"), error);
    });
    expect(report).toContain(expected);
    expect(report).not.toContain("No ESLint diagnostics");
    expect(report).toContain(error.stdout || error.stderr);
  }
});

test("helper launches the selected local CLI with inherited environment and shell-safe arguments", async () => {
  await project();
  const target = await file("quote' $(not-a-command).js");
  await file(
    "node_modules/eslint/bin/eslint.js",
    "console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),path:process.env.PATH}));\n"
  );
  const report = await checkFiles(root, [target]);
  const json = JSON.parse(report.slice(report.indexOf("\n") + 1));
  expect(json.args.at(-1)).toBe(target);
  expect(json.cwd).toBe(root);
  expect(json.path).toBe(process.env.PATH);
});

test("respects an explicit legacy-config environment without executing ESLint", async () => {
  await project();
  const target = await file("source.js");
  process.env.ESLINT_USE_FLAT_CONFIG = "false";
  let ran = false;
  const report = await checkFiles(root, [target], async () => {
    ran = true;
  });
  expect(report).toContain("Skipped: ESLINT_USE_FLAT_CONFIG=false");
  expect(process.env.ESLINT_USE_FLAT_CONFIG).toBe("false");
  expect(ran).toBe(false);
});
