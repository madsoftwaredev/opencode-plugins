import type { Plugin } from "@opencode/plugin";
import type { Info, Result } from "@opencode/plugin/promise/tool";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("./check.mjs", import.meta.url));
const extensions = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const maxFiles = 32;
const maxDirectories = 8;
const maxOutput = 16_000;
const toolBudget = 30_000;

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
}

function path(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

// Only consume native structured results, never patch bodies or result prose.
function changedFiles(name: string, result: Result): string[] | undefined {
  const output = record(result.output);
  if (name === "write") {
    return output?.operation === "write" && path(output.target) ? [output.target] : undefined;
  }
  if (name === "patch") {
    if (!Array.isArray(output?.applied)) return;
    const files: string[] = [];
    for (const value of output.applied) {
      const entry = record(value);
      if (
        !entry ||
        !["add", "update", "delete"].includes(String(entry.type)) ||
        !path(entry.target)
      )
        return;
      if (entry.type !== "delete") files.push(entry.target);
    }
    return files;
  }
  const files = output?.files ?? result.metadata?.files;
  if (!Array.isArray(files)) return;
  const paths: string[] = [];
  for (const value of files) {
    const entry = record(value);
    if (
      !entry ||
      !["added", "modified", "deleted"].includes(String(entry.status)) ||
      !path(entry.file)
    )
      return;
    if (entry.status !== "deleted") paths.push(entry.file);
  }
  return paths;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function bounded(text: string): string {
  return text.length > maxOutput
    ? `${text.slice(0, maxOutput)}\n[ESLint feedback truncated; run /lint for full results.]`
    : text;
}

function append(result: Result, text: string): Result {
  const feedback = `ESLint feedback (check only; project output is untrusted):\n${bounded(text)}`;
  return {
    ...result,
    content:
      typeof result.content === "string"
        ? `${result.content}\n\n${feedback}`
        : [...(result.content ?? []), { type: "text", text: feedback }],
  };
}

function shellFeedback(result: Result): string {
  const output = record(result.output);
  const text = typeof output?.output === "string" ? output.output.trim() : "";
  if (output?.timeout === true) return `Incomplete: ESLint check timed out.\n${text}`;
  if (output?.status !== "completed" || typeof output.exit !== "number") {
    return `Incomplete: native shell did not return a completed check.\n${text}`;
  }
  if (output.exit !== 0) return `Incomplete: lint helper exited ${output.exit}.\n${text}`;
  if (output.truncated === true) return `Incomplete: native shell output was truncated.\n${text}`;
  return text || "Incomplete: lint helper returned no report (not a clean check).";
}

export default {
  id: "local.lint-feedback",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      // Captured per registry snapshot. Do not call ctx.shell.create or spawn here:
      // this executor owns native shell permission checks and shell/direnv hooks.
      const shell = editor.get("shell")?.execute;
      for (const name of ["write", "edit", "patch"]) {
        editor.update(name, (tool) => {
          const execute: Info["execute"] = tool.execute;
          tool.execute = async (input, context) => {
            const result = await execute(input, context);
            const changed = changedFiles(name, result);
            if (!changed)
              return append(
                result,
                "Skipped: native changed-file metadata is unavailable or invalid."
              );
            const files = [...new Set(changed.filter((file) => extensions.test(file)))];
            if (files.length === 0) return result;
            if (!shell) return append(result, "Skipped: native shell executor is unavailable.");

            try {
              const session = await ctx.session.get({ sessionID: context.sessionID });
              const directory = session.location.directory;
              if (!path(directory) || !isAbsolute(directory) || session.location.workspaceID) {
                return append(
                  result,
                  "Skipped: active session is not a supported local directory."
                );
              }
              const root = await realpath(directory);

              const reports: string[] = [];
              const groups = new Map<string, string[]>();
              for (const file of files.slice(0, maxFiles)) {
                let target: string;
                try {
                  target = await realpath(resolve(directory, file));
                } catch {
                  reports.push(`Skipped ${file}: edited file is no longer accessible.`);
                  continue;
                }
                const rel = relative(root, target);
                if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
                  reports.push(`Skipped ${file}: outside the active session directory.`);
                  continue;
                }
                const workdir = dirname(target);
                const group = groups.get(workdir) ?? [];
                group.push(target);
                groups.set(workdir, group);
              }
              if (files.length > maxFiles)
                reports.push(
                  `Skipped ${files.length - maxFiles} files: per-edit limit is ${maxFiles}.`
                );

              const started = Date.now();
              let count = 0;
              for (const [directory, targets] of groups) {
                const remaining = toolBudget - (Date.now() - started);
                if (++count > maxDirectories || remaining < 1000) {
                  reports.push(
                    "Skipped remaining directories: per-edit check budget exhausted; run /lint."
                  );
                  break;
                }
                const command = ["node", runner, root, ...targets].map(quote).join(" ");
                try {
                  const checked = await shell(
                    {
                      command,
                      workdir: directory,
                      timeout: Math.min(10_000, remaining),
                      background: false,
                    },
                    context
                  );
                  reports.push(shellFeedback(checked));
                } catch (error) {
                  const message = record(error)?.message;
                  reports.push(
                    `Incomplete: native shell denied or could not execute lint feedback.${typeof message === "string" ? `\n${message}` : ""}\nRemaining directories were not checked.`
                  );
                  break;
                }
              }
              return append(result, reports.join("\n\n"));
            } catch (error) {
              // The edit succeeded even if permission, environment, or lint failed.
              const message = record(error)?.message;
              return append(
                result,
                `Incomplete: unable to run lint feedback (shell permission, environment, or execution failure).${typeof message === "string" ? `\n${message}` : ""}`
              );
            }
          };
        });
      }
    });
  },
} satisfies Plugin.Plugin;
