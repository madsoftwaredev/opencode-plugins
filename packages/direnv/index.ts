import type { Plugin } from "@opencode/plugin";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export default {
  id: "direnv",
  async setup(ctx) {
    await ctx.shell.hook("create.before", async (event) => {
      let stdout: string;
      try {
        ({ stdout } = await execFileAsync("direnv", ["export", "json"], {
          cwd: event.cwd,
          env: { ...process.env, ...event.env },
          encoding: "utf8",
          timeout: 60_000,
          maxBuffer: 4 * 1024 * 1024,
        }));
      } catch {
        // direnv's output can contain secrets printed by .envrc; keep it out of logs.
        throw new Error(
          `Could not load direnv in ${event.cwd}. Check that direnv is on PATH and run ` +
            "`direnv status` there; use `direnv allow` if the environment needs approval."
        );
      }

      // direnv emits no output when the inherited environment is already current.
      if (!stdout.trim()) return;

      let changes: unknown;
      try {
        changes = JSON.parse(stdout);
      } catch {
        throw new Error("direnv returned invalid JSON.");
      }
      if (typeof changes !== "object" || changes === null || Array.isArray(changes)) {
        throw new Error("direnv returned an invalid environment diff.");
      }

      const entries = Object.entries(changes as Record<string, unknown>);
      for (const [, value] of entries) {
        if (value !== null && typeof value !== "string") {
          throw new Error("direnv returned an invalid environment value.");
        }
      }

      for (const [key, value] of entries) {
        // Keep an explicit undefined override so unsets also mask the server's env.
        Object.defineProperty(event.env, key, {
          value: value === null ? undefined : value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    });
  },
} satisfies Plugin.Plugin;
