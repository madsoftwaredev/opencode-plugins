import { expect, test } from "bun:test";
import { activityStatus, isActive } from "./activity";

test.each([
  [undefined, "idle", 0, "idle"],
  ["succeeded", "idle", 0, "done"],
  ["failed", "idle", 0, "failed"],
  ["interrupted", "idle", 0, "stopped"],
  [undefined, "idle", 1, "pending"],
  ["interrupted", "idle", 1, "pending"],
  ["succeeded", "idle", 1, "pending"],
  [undefined, "running", 0, "running"],
  ["interrupted", "running", 1, "running"],
])("native outcome %s, live %s, queue %s renders %s", (outcome, live, pending, expected) => {
  expect(activityStatus({ outcome }, live, pending)).toBe(expected);
});

test("an idle timestamp without an outcome does not imply interrupted or queued work", () => {
  expect(activityStatus({ time: { idle: 10 } }, "idle", 0)).toBe("idle");
});

test("only running and positively queued work sort as active", () => {
  expect(isActive("running")).toBe(true);
  expect(isActive("pending")).toBe(true);
  for (const status of ["idle", "done", "failed", "stopped"]) expect(isActive(status)).toBe(false);
});
