// This module runs as a native-shell-authorized command, NOT in a plugin hook.
import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const configNames = ["js", "mjs", "cjs", "ts", "mts", "cts"].map((ext) => `eslint.config.${ext}`);
const maxOutput = 12_000;

function inside(root, target) {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function localFile(root, candidate) {
  let target;
  try {
    target = await realpath(candidate);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
    throw error;
  }
  if (!inside(root, target)) throw new Error(`Symlink leaves the active directory: ${candidate}`);
  const info = await stat(target);
  if (!info.isFile()) throw new Error(`Not a regular file: ${candidate}`);
  return { path: target, size: info.size };
}

// All searches stop at the session directory, including in non-Git projects.
export async function selectProject(root, file) {
  root = await realpath(root);
  file = resolve(root, file);
  if (!inside(root, file)) throw new Error("File is outside the active directory.");
  const target = await localFile(root, file);
  if (!target) return { skip: "file no longer exists" };
  file = target.path;
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(file)) return { skip: "not a JS/TS-family file" };

  let config;
  let binary;
  let manifest;
  let directory = dirname(file);
  for (let depth = 0; depth < 64; depth++) {
    if (!config) {
      for (const name of configNames) {
        if (await localFile(root, join(directory, name))) {
          config = join(directory, name);
          break;
        }
      }
    }
    if (!binary) {
      const candidate = await localFile(root, join(directory, "node_modules/eslint/bin/eslint.js"));
      if (candidate) {
        const metadata = await localFile(root, join(directory, "node_modules/eslint/package.json"));
        if (!metadata || metadata.size > 256_000)
          throw new Error("Invalid local ESLint package metadata.");
        manifest = JSON.parse(await readFile(metadata.path, "utf8"));
        binary = candidate.path;
      }
    }
    if ((config && binary) || directory === root) break;
    directory = dirname(directory);
  }
  if (!config)
    return {
      skip: "no flat eslint.config.* within the active directory (legacy configs require /lint)",
    };
  if (!binary) return { skip: "no project-installed ESLint within the active directory" };
  const major = Number(manifest.version?.split(".")[0]);
  if (manifest.name !== "eslint" || (major !== 9 && major !== 10)) {
    return {
      skip: "automatic feedback supports local ESLint 9/10 flat configs; use /lint for this installation",
    };
  }
  return { file, config, binary, cwd: dirname(config) };
}

function clip(text) {
  return text.length > maxOutput
    ? `${text.slice(0, maxOutput)}\n[Output truncated; run /lint.]`
    : text;
}

export async function checkFiles(root, files, run = execute) {
  if (!isAbsolute(root) || files.length === 0 || files.length > 32) {
    throw new Error("Expected an absolute session directory and 1–32 explicit files.");
  }
  if (process.env.ESLINT_USE_FLAT_CONFIG === "false") {
    return "Skipped: ESLINT_USE_FLAT_CONFIG=false; legacy config checks remain explicit via /lint.";
  }
  const reports = [];
  const groups = new Map();
  for (const file of new Set(files)) {
    if (typeof file !== "string" || file.length > 4096 || /[\x00-\x1f\x7f]/.test(file)) {
      reports.push("Skipped: invalid changed-file path.");
      continue;
    }
    try {
      const project = await selectProject(root, file);
      if (project.skip) {
        reports.push(`Skipped ${file}: ${project.skip}.`);
        continue;
      }
      const key = JSON.stringify([project.config, project.binary]);
      const group = groups.get(key) ?? { ...project, files: [] };
      group.files.push(project.file);
      groups.set(key, group);
    } catch (error) {
      reports.push(`Skipped ${file}: ${error.message}`);
    }
  }

  const deadline = Date.now() + 8000;
  for (const group of groups.values()) {
    const timeout = deadline - Date.now();
    if (timeout <= 0) {
      reports.push("Incomplete: check time budget exhausted; remaining files were not linted.");
      break;
    }
    const label = group.files.join(", ");
    // Explicit config + its own cwd preserves flat-config pattern bases, without
    // allowing ESLint to discover a home/global config above the session root.
    const args = [
      group.binary,
      "--no-config-lookup",
      "--config",
      group.config,
      "--format",
      "stylish",
      "--no-color",
      "--",
      ...group.files,
    ];
    try {
      const result = await run(process.execPath, args, {
        cwd: group.cwd,
        encoding: "utf8",
        timeout,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024,
        // Inherit the native shell/direnv environment unchanged.
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
      reports.push(
        output
          ? `ESLint output for ${label} (exit 0; may include warnings or ignored files):\n${output}`
          : `No ESLint diagnostics: ${label}`
      );
    } catch (error) {
      const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
      let status;
      if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
        status = "Incomplete: ESLint output limit exceeded";
      else if (error.killed || error.signal)
        status = "Incomplete: ESLint timed out or was terminated";
      else if (error.code === 1) status = "ESLint found lint errors";
      else status = `Incomplete: ESLint configuration/execution error (${error.code ?? "unknown"})`;
      reports.push(`${status}: ${label}\n${output || error.message}`);
    }
  }
  return clip(reports.join("\n\n"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, ...files] = process.argv.slice(2);
  try {
    console.log(await checkFiles(root, files));
  } catch (error) {
    console.error(`Incomplete: lint helper failed: ${error.message}`);
    process.exitCode = 2;
  }
}
