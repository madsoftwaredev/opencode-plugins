import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import plugin from "./index";

const execFileAsync = promisify(execFile);
let root;
let baseEnv;
let hook;

beforeEach(async () => {
  const temporary = join(tmpdir(), "opencode");
  await mkdir(temporary, { recursive: true });
  root = await realpath(await mkdtemp(join(temporary, "direnv-v2-")));
  baseEnv = { ...process.env };
  for (const key of Object.keys(baseEnv)) {
    if (key.startsWith("DIRENV_")) baseEnv[key] = undefined;
  }
  baseEnv.XDG_CONFIG_HOME = join(root, "config");
  baseEnv.XDG_DATA_HOME = join(root, "data");
  baseEnv.XDG_CACHE_HOME = join(root, "cache");
  baseEnv.DIRENV_CONFIG = join(root, "config", "direnv");
  await mkdir(baseEnv.DIRENV_CONFIG, { recursive: true });

  await plugin.setup({
    shell: {
      async hook(name, callback) {
        expect(name).toBe("create.before");
        hook = callback;
        return { async dispose() {} };
      },
    },
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function project(name, contents, approved = true) {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, ".envrc"), contents);
  if (approved) {
    await execFileAsync("direnv", ["allow", directory], { env: baseEnv });
  }
  return directory;
}

async function environment(cwd, env = baseEnv) {
  const event = { cwd, env: { ...env }, command: "true", shell: "/bin/sh", timeout: 120_000 };
  await hook(event);
  return event.env;
}

test("loads parent envrc, PATH, empty values and unsets without changing the server environment", async () => {
  const before = { ...process.env };
  const directory = await project(
    "project with spaces",
    'export OPENCODE_DIRENV_TEST="loaded value"\nexport OPENCODE_DIRENV_EMPTY=""\nunset OPENCODE_DIRENV_REMOVE\nPATH_add bin\n'
  );
  const nested = join(directory, "nested");
  await mkdir(nested);
  const env = await environment(nested, { ...baseEnv, OPENCODE_DIRENV_REMOVE: "inherited" });

  const { stdout } = await execFileAsync(
    process.execPath,
    ["-e", "console.log(JSON.stringify(process.env))"],
    { env }
  );
  const child = JSON.parse(stdout);
  expect(child.OPENCODE_DIRENV_TEST).toBe("loaded value");
  expect(child.OPENCODE_DIRENV_EMPTY).toBe("");
  expect(child.OPENCODE_DIRENV_REMOVE).toBeUndefined();
  expect(child.PATH.split(":")[0]).toBe(join(directory, "bin"));
  expect(process.env).toEqual(before);
});

test("isolates concurrent projects and unloads an inherited project environment", async () => {
  const first = await project("first", "export OPENCODE_DIRENV_FIRST=first\nPATH_add bin\n");
  const second = await project("second", "export OPENCODE_DIRENV_SECOND=second\n");
  const [firstEnv, secondEnv] = await Promise.all([environment(first), environment(second)]);
  expect(firstEnv.OPENCODE_DIRENV_SECOND).toBeUndefined();
  expect(secondEnv.OPENCODE_DIRENV_FIRST).toBeUndefined();

  const switched = await environment(second, firstEnv);
  expect(switched.OPENCODE_DIRENV_FIRST).toBeUndefined();
  expect(switched.OPENCODE_DIRENV_SECOND).toBe("second");
  expect(switched.PATH).toBe(baseEnv.PATH);

  const unloaded = await environment(root, firstEnv);
  expect(unloaded.OPENCODE_DIRENV_FIRST).toBeUndefined();
  expect(unloaded.PATH).toBe(baseEnv.PATH);
});

test("respects approval changes and loads updated values after approval", async () => {
  const directory = await project("approved", "export OPENCODE_DIRENV_TEST=before\n");
  expect((await environment(directory)).OPENCODE_DIRENV_TEST).toBe("before");
  await writeFile(join(directory, ".envrc"), "export OPENCODE_DIRENV_TEST=after\n");
  await expect(environment(directory)).rejects.toThrow("Could not load direnv");
  await execFileAsync("direnv", ["allow", directory], { env: baseEnv });
  expect((await environment(directory)).OPENCODE_DIRENV_TEST).toBe("after");
});

test("rejects unapproved and failing envrc files without exposing their output", async () => {
  const blocked = await project("blocked", "export OPENCODE_DIRENV_TEST=blocked\n", false);
  await expect(environment(blocked)).rejects.toThrow("direnv allow");

  const failing = await project("failing", "echo SECRET_TEST_VALUE >&2\nexit 1\n");
  try {
    await environment(failing);
    throw new Error("Expected loading to fail");
  } catch (error) {
    expect(error.message).toContain("Could not load direnv");
    expect(error.message).not.toContain("SECRET_TEST_VALUE");
  }
});

test("leaves a clean directory's environment unchanged", async () => {
  expect(await environment(root)).toEqual(baseEnv);
});
