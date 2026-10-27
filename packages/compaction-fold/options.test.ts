import { expect, test } from "bun:test";
import { parseOptions } from "./options";

test("summaries default closed and accept either boolean preference", () => {
  expect(parseOptions({}).defaultExpanded).toBe(false);
  expect(parseOptions({ defaultExpanded: false }).defaultExpanded).toBe(false);
  expect(parseOptions({ defaultExpanded: true }).defaultExpanded).toBe(true);
});

test("invalid preferences are rejected instead of interpreting truthy strings", () => {
  for (const defaultExpanded of ["false", "true", 0, 1, null, [], {}]) {
    expect(() => parseOptions({ defaultExpanded })).toThrow("defaultExpanded must be a boolean");
  }
});

test("helpers keep OpenTUI runtime imports in the rewritten entrypoint only", async () => {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const source = await Bun.file(new URL("./fold.ts", import.meta.url)).text();
  expect(transpiler.scanImports(transpiler.transformSync(source))
    .filter((entry) => entry.path.startsWith("@opentui/"))).toEqual([]);
});
