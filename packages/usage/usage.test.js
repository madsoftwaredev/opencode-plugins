import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildReport,
  cacheHitRate,
  emptyMetrics,
  formatCost,
  formatTokens,
  totalTokens,
} from "./usage.ts";
import { metricTable, modelTable, splitModelTables, readOptions } from "./view.ts";

const model = { providerID: "openai", id: "reasoner", variant: "high" };
const tokens = (input = 0, output = 0, reasoning = 0, read = 0, write = 0) => ({
  input,
  output,
  reasoning,
  cache: { read, write },
});
const session = (id, usage, cost, parentID) => ({ id, tokens: usage, cost, parentID });
const message = (id, usage, cost, selected = model, type = "assistant") => ({
  id,
  type,
  model: selected,
  tokens: usage,
  cost,
});

test("totals include every disjoint bucket and each session only once", () => {
  const main = session("main", tokens(100, 20, 30, 400, 50), 0.3);
  const child = session("child", tokens(10, 5, 6, 70, 8), 0.2, "main");
  const report = buildReport([main, child, main], new Map());
  assert.equal(totalTokens(report.main.tokens), 600);
  assert.equal(totalTokens(report.subagents.tokens), 99);
  assert.equal(totalTokens(report.total.tokens), 699);
  assert.equal(report.total.cost, 0.5);
  assert.equal(report.sessions.length, 2);
  assert.equal(cacheHitRate(main.tokens), 400 / 550);
  assert.equal(cacheHitRate(emptyMetrics().tokens), undefined);
});

test("model attribution distinguishes providers and variants, includes compaction, and ignores in-flight usage", () => {
  const main = session("main", tokens(40, 8, 4, 20, 2), 0.5);
  const child = session("child", tokens(10, 2), 0.1, "main");
  const first = message("1", tokens(20, 4, 2, 10, 1), 0.2);
  const histories = new Map([
    [
      "main",
      [
        first,
        first,
        message("2", tokens(10, 2, 1, 5, 1), 0.2, { ...model, variant: "low" }),
        message("3", tokens(10, 2, 1, 5), 0.1, model, "compaction"),
        { id: "4", type: "assistant", model },
        { id: "5", type: "user" },
      ],
    ],
    ["child", [message("6", child.tokens, child.cost, { ...model, providerID: "other" })]],
  ]);
  const report = buildReport([main, child], histories);
  assert.equal(report.models.length, 3);
  assert.equal(report.modelTotals.length, 2);
  const combined = report.modelTotals.find((row) => row.model.providerID === "openai");
  assert.equal(totalTokens(combined.tokens), 74);
  assert.equal(combined.steps, 2);
  assert.equal(combined.compactions, 1);
  assert.equal(combined.cost, 0.5);
  const high = report.models.find(
    (row) => row.model.providerID === "openai" && row.model.variant === "high"
  );
  assert.equal(high.steps, 1);
  assert.equal(high.compactions, 1);
  assert.equal(totalTokens(high.tokens), 55);
  assert.equal(totalTokens(report.unattributed.tokens), 0);
  assert.equal(report.mismatch, false);
  assert.equal(histories.get("main")[0], first);
});

test("auxiliary usage stays unattributed instead of being guessed from the selected model", () => {
  const main = { ...session("main", tokens(110, 25, 10, 50, 5), 0.55), model };
  const report = buildReport(
    [main],
    new Map([["main", [message("1", tokens(100, 20, 10, 50, 5), 0.5)]]])
  );
  assert.equal(totalTokens(report.total.tokens), 200);
  assert.equal(totalTokens(report.unattributed.tokens), 15);
  assert.ok(Math.abs(report.unattributed.cost - 0.05) < 1e-8);
  assert.equal(report.models[0].tokens.input, 100);
});

test("missing costs, real zero, unavailable histories, and disagreement with recorded totals remain distinct", () => {
  const main = session("main", tokens(10), 0);
  const child = session("child", tokens(30), 0, "main");
  const report = buildReport(
    [main, child],
    new Map([["main", [message("1", tokens(20), undefined)]]])
  );
  assert.equal(report.total.tokens.input, 40);
  assert.equal(report.models[0].missingCosts, 1);
  assert.equal(formatCost(report.models[0].cost, true), "—");
  assert.equal(formatCost(report.total.cost), "$0.0000");
  assert.equal(report.sessions[1].loaded, false);
  assert.equal(report.mismatch, true);
  assert.equal(report.unattributed.tokens.input, 0);
  assert.throws(
    () => buildReport([session("bad", tokens(-1), 0)], new Map()),
    /invalid recorded usage/
  );
});

test("popup tables retain exact counts and sidebar formatting does not imply tiny costs are zero", () => {
  const main = session("main", tokens(1_234_567, 2, 3, 4, 5), 0.000001);
  const report = buildReport([main], new Map([["main", [message("1", main.tokens, main.cost)]]]));
  const matrix = modelTable(report.models);
  assert.equal(matrix.headers.length, matrix.rows[0].length);
  assert.ok(matrix.rows[0].includes("1,234,567"));
  assert.ok(matrix.rows[0].includes("1,234,581"));
  assert.ok(matrix.rows[0].includes("<$0.0001"));
  const split = splitModelTables(report.models);
  assert.ok(split.tokens.rows[0].includes("1,234,567"));
  assert.ok(split.accounting.rows[0].includes("<$0.0001"));
  assert.equal(split.tokens.rows[0][0], split.accounting.rows[0][0]);
  const narrow = metricTable([{ label: "Recorded", metrics: report.total }]);
  assert.ok(narrow.width < 40);
  assert.equal(formatTokens(1_234_567, true), "1.23m");
  assert.deepEqual(readOptions({}), { sidebar: true, includeSubagents: true });
  assert.deepEqual(readOptions({ sidebar: false }), { sidebar: false, includeSubagents: true });
  assert.throws(() => readOptions({ includeSubagents: "false" }), /must be a boolean/);
});

test("sessions without recorded accounting count as zero instead of throwing", () => {
  // Records that arrive without tokens/cost (no accounting step completed
  // yet) must fold in as zero, not crash the report.
  const fresh = { id: "fresh", cost: 0 };
  const step = session("step", tokens(5, 1), 0.01, "fresh");
  const errored = { id: "errored", type: "assistant", model, cost: 0 };
  const histories = new Map([["step", [errored]]]);
  const report = buildReport([fresh, step], histories);
  assert.equal(totalTokens(report.total.tokens), 6);
  assert.equal(report.total.cost, 0.01);
});
