/**
 * Tests for the release decision. Publishing itself is exercised by
 * `bun scripts/publish.ts <package> --dry-run`, which only reads the registry.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { planRelease } from "./release.ts";

test("skips a package whose exact version is already published", async () => {
  let reads = 0;
  const plan = await planRelease("stats", "0.1.2", {
    readPublishedVersion: async () => {
      reads += 1;
      return "0.1.2";
    },
  });

  assert.deepEqual(plan, {
    status: "skip",
    reason: "stats@0.1.2 is already published.",
  });
  assert.equal(reads, 1);
});

test("publishes a bumped package even when siblings stay behind", async () => {
  const plan = await planRelease("stats", "0.1.3", {
    readPublishedVersion: async () => "0.1.2",
  });

  assert.deepEqual(plan, { status: "publish", publishedVersion: "0.1.2" });
});

test("publishes a version that is behind the registry, which is still a new artifact", async () => {
  const plan = await planRelease("direnv", "0.1.1", {
    readPublishedVersion: async () => "0.1.2",
  });

  assert.deepEqual(plan, { status: "publish", publishedVersion: "0.1.2" });
});

test("publishes a never-released package", async () => {
  const plan = await planRelease("btw", "0.1.0", {
    readPublishedVersion: async () => null,
  });

  assert.deepEqual(plan, { status: "publish", publishedVersion: null });
});

test("does not swallow registry failures", async () => {
  await assert.rejects(
    planRelease("stats", "0.1.3", {
      readPublishedVersion: async () => {
        throw new Error("Could not read @madsoftwaredev/opencode-stats from the registry");
      },
    }),
    /Could not read/
  );
});
