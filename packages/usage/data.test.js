import assert from "node:assert/strict";
import { test } from "node:test";
import { createUsageTracker, loadFamily, loadMessages, pageInput } from "./data.ts";
import { emptyMetrics, totalTokens } from "./usage.ts";

const session = (id, parentID, input = 10) => ({
  id,
  parentID,
  ...emptyMetrics(),
  tokens: { ...emptyMetrics().tokens, input },
});
const msg = (id, input) => ({
  id,
  type: "assistant",
  model: { providerID: "test", id: "model" },
  tokens: { ...emptyMetrics().tokens, input },
  cost: 0,
});
const page = (data, next) => ({ data, cursor: { next } });
const signal = () => new AbortController().signal;

function client(sessions = [session("main")], histories = new Map()) {
  return {
    model: { list: async () => ({ data: [] }) },
    session: {
      get: async ({ sessionID }) => {
        const saved = sessions.find((item) => item.id === sessionID);
        if (!saved) throw new Error("not found");
        return saved;
      },
      list: async ({ parentID }) => page(sessions.filter((item) => item.parentID === parentID)),
    },
    message: { list: async ({ sessionID }) => page(histories.get(sessionID) ?? []) },
  };
}

function observer(api) {
  const states = [];
  const waiting = [];
  const tracker = createUsageTracker(api, (state) => {
    states.push(state);
    if (state && !state.loading) {
      for (const resolve of waiting.splice(0)) resolve(state);
    }
  });
  return { tracker, states, ready: () => new Promise((resolve) => waiting.push(resolve)) };
}

test("family discovery paginates and recursively includes each descendant but not separate forks or unrelated chats", async () => {
  const main = session("main");
  const child = session("child", "main");
  const old = session("old", "main");
  const grandchild = session("grandchild", "child");
  const api = client([main]);
  const calls = [];
  api.session.list = async (input) => {
    calls.push(input);
    if (input.cursor === "older-children") return page([old, child]);
    if (input.parentID === "main")
      return page([child, session("unrelated", "different")], "older-children");
    if (input.parentID === "child") return page([grandchild, main]);
    return page([]);
  };
  const result = await loadFamily(api, "main", true, signal());
  assert.deepEqual(
    result.sessions.map((item) => item.id),
    ["main", "child", "old", "grandchild"]
  );
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    calls.find((input) => input.cursor),
    { limit: 200, cursor: "older-children" }
  );
  assert.equal(calls.filter((input) => input.parentID === "child").length, 1);
  const own = await loadFamily(api, "main", false, signal());
  assert.deepEqual(own.sessions, [main]);
});

test("partial discovery errors are visible and aborted discovery does not become a partial success", async () => {
  const api = client();
  api.session.list = async () => {
    throw new Error("offline");
  };
  const result = await loadFamily(api, "main", true, signal());
  assert.equal(result.sessions.length, 1);
  assert.equal(result.warnings.length, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadFamily(api, "main", true, controller.signal), { name: "AbortError" });
});

test("history pagination keeps only accounting fields and replaces recent overlapping messages instead of double-counting", async () => {
  const api = client();
  const calls = [];
  api.message.list = async (input) => {
    calls.push(input);
    return input.cursor
      ? page([msg("1", 10)])
      : page(
          [{ ...msg("3", 30), content: [{ text: "private prompt/tool output" }] }, msg("2", 20)],
          "older"
        );
  };
  const initial = await loadMessages(api, "main", signal());
  assert.deepEqual(calls, [
    { sessionID: "main", limit: 200, order: "desc" },
    { sessionID: "main", limit: 200, cursor: "older" },
  ]);
  assert.equal(
    initial.reduce((sum, item) => sum + item.tokens.input, 0),
    60
  );
  assert.equal("content" in initial.find((item) => item.id === "3"), false);
  calls.length = 0;
  api.message.list = async (input) => {
    calls.push(input);
    return page([msg("4", 40), msg("3", 35)], "older");
  };
  const updated = await loadMessages(api, "main", signal(), initial);
  assert.equal(calls.length, 1);
  assert.equal(
    updated.reduce((sum, item) => sum + item.tokens.input, 0),
    105
  );
  assert.equal(updated.filter((item) => item.id === "3").length, 1);
  api.message.list = async () => page([msg("replacement", 5)]);
  assert.deepEqual(
    (await loadMessages(api, "main", signal(), updated)).map((item) => item.id),
    ["replacement"]
  );
});

test("repeated cursors fail rather than looping forever", async () => {
  const api = client();
  api.message.list = async () => page([msg("1", 1)], "same");
  await assert.rejects(loadMessages(api, "main", signal()), /repeated message cursor/);
  assert.deepEqual(pageInput("cursor"), { limit: 200, cursor: "cursor" });
});

test("tracker loads model accounting for API totals and refreshes subagents without double-counting repeated events", async () => {
  const sessions = [session("main"), session("child", "main", 20)];
  const histories = new Map([
    ["main", [msg("1", 10)]],
    ["child", [msg("2", 20)]],
  ]);
  const api = client(sessions, histories);
  let requests = 0;
  const list = api.message.list;
  api.message.list = async (input) => {
    requests += 1;
    return list(input);
  };
  const { tracker, ready } = observer(api);
  const first = ready();
  tracker.select("main");
  assert.equal(totalTokens((await first).report.total.tokens), 30);
  assert.equal(requests, 2);
  const detail = ready();
  tracker.details();
  assert.equal((await detail).report.models[0].tokens.input, 30);
  assert.equal(requests, 2);

  sessions[1] = session("child", "main", 25);
  histories.set("child", [msg("2", 25)]);
  const updated = ready();
  tracker.changed("session.usage.updated", "child");
  tracker.changed("session.usage.updated", "child");
  tracker.details(); // Flush the coalesced work without waiting on real time.
  const snapshot = await updated;
  assert.equal(snapshot.report.total.tokens.input, 35);
  assert.equal(snapshot.report.models[0].tokens.input, 35);
  assert.equal(requests, 3);
  tracker.dispose();
});

test("sidebar prices subscription usage automatically, keeps actual zero, and refresh reloads API rates", async () => {
  const sessions = [session("main", undefined, 1_000_000)];
  const api = client(sessions, new Map([["main", [msg("1", 1_000_000)]]]));
  let rate = 2;
  let catalogs = 0;
  api.model.list = async () => {
    catalogs += 1;
    return {
      data: [
        {
          providerID: "test",
          id: "model",
          modelID: "model",
          cost: [{ input: rate, output: 10, cache: { read: 0.1, write: 0 } }],
        },
      ],
    };
  };
  const { tracker, ready } = observer(api);
  const initial = ready();
  tracker.select("main", false);
  const first = await initial;
  assert.equal(first.report.total.api.usd, 2);
  assert.equal(first.report.total.cost, 0);
  assert.equal(first.detailed, false);
  const synced = ready();
  tracker.resync();
  await synced;
  assert.equal(catalogs, 1);
  rate = 3;
  const refreshed = ready();
  tracker.refresh();
  assert.equal((await refreshed).report.total.api.usd, 3);
  assert.equal(catalogs, 2);
  assert.equal(first.report.total.api.usd, 2);
  tracker.dispose();
});

test("historical Fast usage from nested subagents is priced on every page and rolled into sidebar totals once", async () => {
  const sessions = [
    session("main", undefined, 1_000_000),
    session("child", "main", 1_000_000),
    session("grandchild", "child", 1_000_000),
  ];
  const standard = { providerID: "openai", id: "gpt-6-luna" };
  const fast = { ...standard, id: "gpt-6-luna-fast" };
  const history = new Map(
    sessions.map((s, index) => [
      s.id,
      [
        { ...msg(`${s.id}-2`, 500_000), model: index ? fast : standard },
        { ...msg(`${s.id}-1`, 500_000), model: index ? fast : standard, type: "compaction" },
      ],
    ])
  );
  const api = client(sessions, history);
  // Only the paid API counterpart is still listed; no historical OpenAI entries remain.
  api.model.list = async () => ({
    data: [
      {
        providerID: "opencode",
        id: "gpt-6-luna",
        modelID: "gpt-6-luna",
        cost: [
          { input: 0.1, output: 0.5, cache: { read: 0.01, write: 0.125 } },
          {
            tier: { type: "context", size: 272_000 },
            input: 0.2,
            output: 0.75,
            cache: { read: 0.02, write: 0.25 },
          },
        ],
      },
    ],
  });
  api.message.list = async ({ sessionID, cursor }) =>
    cursor ? page([history.get(sessionID)[1]]) : page([history.get(sessionID)[0]], "older");
  const { tracker, ready } = observer(api);
  const initial = ready();
  tracker.select("main");
  const first = await initial;
  assert.equal(first.report.sessions.length, 3);
  assert.equal(first.report.total.tokens.input, 3_000_000);
  assert.equal(first.report.main.api.usd, 0.2);
  assert.equal(first.report.subagents.api.usd, 0.8);
  assert.equal(first.report.total.api.usd, 1);
  assert.equal(first.report.total.api.missingTokens, 0);
  assert.equal(first.report.total.cost, 0);
  const refresh = ready();
  tracker.refresh();
  assert.equal((await refresh).report.total.api.usd, 1);
  tracker.dispose();
});

test("new subagents are discovered, removed ones disappear on refresh, and full refresh drops reverted history", async () => {
  const sessions = [session("main")];
  const histories = new Map([["main", [msg("2", 5), msg("1", 5)]]]);
  const { tracker, ready } = observer(client(sessions, histories));
  const first = ready();
  tracker.select("main");
  await first;
  const detail = ready();
  tracker.details();
  await detail;
  sessions.push(session("child", "main", 7));
  histories.set("child", [msg("3", 7)]);
  const created = ready();
  tracker.changed("session.created", "child", "main");
  tracker.details();
  assert.equal((await created).report.total.tokens.input, 17);
  sessions.pop();
  sessions[0] = session("main", undefined, 5);
  histories.set("main", [msg("1", 5)]);
  const reverted = ready();
  tracker.refresh();
  const snapshot = await reverted;
  assert.equal(snapshot.report.sessions.length, 1);
  assert.equal(snapshot.report.models[0].tokens.input, 5);
  tracker.dispose();
});

test("late results from an old chat never replace the selected chat", async () => {
  const api = client([session("next", undefined, 42)]);
  const get = api.session.get;
  let resolveOld;
  api.session.get = ({ sessionID }, options) =>
    sessionID === "old"
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : get({ sessionID }, options);
  const { tracker, states, ready } = observer(api);
  tracker.select("old");
  const next = ready();
  tracker.select("next", false);
  assert.equal((await next).report.total.tokens.input, 42);
  const count = states.length;
  resolveOld(session("old", undefined, 999));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(states.length, count);
  assert.equal(states.at(-1).sessionID, "next");
  tracker.dispose();
});

test("accounting resync recovers missed subagent events without re-fetching unchanged histories", async () => {
  const sessions = [session("main"), session("child", "main", 20)];
  const histories = new Map([
    ["main", [msg("1", 10)]],
    ["child", [msg("2", 20)]],
  ]);
  const api = client(sessions, histories);
  let requests = 0;
  const list = api.message.list;
  api.message.list = async (input) => {
    requests += 1;
    return list(input);
  };
  const { tracker, ready } = observer(api);
  const first = ready();
  tracker.select("main");
  await first;
  const detailed = ready();
  tracker.details();
  await detailed;
  const unchanged = ready();
  tracker.resync();
  await unchanged;
  assert.equal(requests, 2);
  sessions[1] = session("child", "main", 25);
  histories.set("child", [msg("2", 25)]);
  const changed = ready();
  tracker.resync();
  assert.equal((await changed).report.models[0].tokens.input, 35);
  assert.equal(requests, 3);
  tracker.dispose();
});

test("a committed revert while the popup is closed invalidates cached model attribution", async () => {
  const sessions = [session("main")];
  const histories = new Map([["main", [msg("2", 5), msg("1", 5)]]]);
  const { tracker, ready } = observer(client(sessions, histories));
  const first = ready();
  tracker.select("main");
  await first;
  const initial = ready();
  tracker.details();
  await initial;
  tracker.closeDetails();
  sessions[0] = session("main", undefined, 5);
  histories.set("main", [msg("1", 5)]);
  const reverted = ready();
  tracker.changed("session.revert.committed", "main");
  tracker.resync();
  await reverted;
  const reopened = ready();
  tracker.refresh();
  assert.equal((await reopened).report.models[0].tokens.input, 5);
  tracker.dispose();
});

test("a held report stays stable while sidebar updates, and reopening reloads changed model usage", async () => {
  const sessions = [session("main")];
  const histories = new Map([["main", [msg("1", 10)]]]);
  const { tracker, ready } = observer(client(sessions, histories));
  const initial = ready();
  tracker.select("main", false);
  await initial;
  const detailed = ready();
  tracker.details();
  const held = await detailed;
  tracker.closeDetails();

  sessions[0] = session("main", undefined, 25);
  histories.set("main", [msg("2", 15), msg("1", 10)]);
  const sidebar = ready();
  tracker.resync();
  assert.equal((await sidebar).report.total.tokens.input, 25);
  assert.equal(held.report.total.tokens.input, 10);
  assert.equal(held.report.models[0].tokens.input, 10);

  const reopened = ready();
  tracker.details();
  const current = await reopened;
  assert.equal(current.report.models[0].tokens.input, 25);
  assert.equal(current.report.unattributed.tokens.input, 0);
  tracker.closeDetails();

  sessions[0] = session("main", undefined, 30);
  histories.set("main", [msg("3", 5), msg("2", 15), msg("1", 10)]);
  const refreshed = ready();
  tracker.refresh();
  assert.equal((await refreshed).report.models[0].tokens.input, 30);
  tracker.dispose();
});

test("refresh failures keep last known usage, and successful resync clears stale warnings", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = client();
  const { tracker, ready } = observer(api);
  const first = ready();
  tracker.select("main");
  await first;
  api.session.get = async () => {
    throw new Error("offline");
  };
  const refreshed = ready();
  tracker.changed("session.usage.updated", "main");
  t.mock.timers.tick(250);
  const snapshot = await refreshed;
  assert.equal(snapshot.report.total.tokens.input, 10);
  assert.equal(snapshot.warnings.length, 1);
  api.session.get = async () => session("main", undefined, 25);
  const recovered = ready();
  tracker.resync();
  const fresh = await recovered;
  assert.equal(fresh.report.total.tokens.input, 25);
  assert.equal(fresh.warnings.length, 0);
  tracker.dispose();
});

test("a report-build failure degrades to a warning and leaves the tracker usable", async () => {
  // A negative cost trips buildReport's invalid-recorded-usage guard.
  // Previously that throw escaped emit(): the final drained publish never
  // arrived (the UI sat at loading forever), and once a run's family was
  // loaded the throw also left drain's running flag stuck true,
  // short-circuiting every later refresh on the same run. Before the fix
  // the first await below never settles; after it, the degraded publish
  // arrives and resync() recovers on the SAME run.
  const broken = { ...session("broken"), cost: -1 };
  const api = client([broken, session("main")]);
  const { tracker, ready } = observer(api);
  const degraded = ready();
  tracker.select("broken", false);
  const bad = await degraded;
  assert.equal(bad.loading, false);
  assert.equal(bad.report, undefined);
  assert.ok(bad.warnings.some((warning) => /report/i.test(warning)));
  // Recovery must be exercised on the SAME run; a fresh select() would hide
  // the wedge, since a brand-new run always starts with running=false.
  api.session.get = async ({ sessionID }) => {
    const saved = sessionID === "broken" ? session("broken") : undefined;
    if (!saved) throw new Error("not found");
    return saved;
  };
  const recovered = ready();
  tracker.resync();
  const good = await recovered;
  assert.equal(good.report.total.tokens.input, 10);
  assert.equal(good.warnings.length, 0);
  tracker.dispose();
});
