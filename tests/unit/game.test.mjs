import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as G from "../../public/game.js";

test("functions/game.mjs is an exact copy of public/game.js (run `npm run sync`)", () => {
  const a = readFileSync(new URL("../../public/game.js", import.meta.url), "utf8");
  const b = readFileSync(new URL("../../functions/game.mjs", import.meta.url), "utf8");
  assert.equal(b, a);
});

test("level curve matches the plan", () => {
  assert.equal(G.levelStart(2), 60);
  assert.equal(G.levelStart(3), 208);
  assert.equal(G.levelStart(5), 822);
  assert.equal(G.levelStart(10), 4617);
  assert.equal(G.levelStart(20), 24172);
  assert.equal(G.levelFor(0), 1);
  assert.equal(G.levelFor(59), 1);
  assert.equal(G.levelFor(60), 2);
  assert.equal(G.levelFor(207), 2);
  assert.equal(G.levelFor(208), 3);
  assert.equal(G.levelFor(1e9), G.MAX_LEVEL);
  const p = G.levelProgress(100);
  assert.deepEqual([p.level, p.into, p.need], [2, 40, 148]);
  assert.equal(G.levelProgress(1e9).need, 0);
});

test("freezes come every 5 levels", () => {
  assert.equal(G.freezeLevels(1, 4), 0);
  assert.equal(G.freezeLevels(4, 5), 1);
  assert.equal(G.freezeLevels(1, 11), 2);
  assert.equal(G.freezeLevels(5, 5), 0);
});

test("unlocks: starters free, new creatures and modes by level, 'soon' modes never", () => {
  const l1 = G.unlockedIds(1, {});
  for (const s of G.STARTERS) assert.ok(l1.includes("c:" + s));
  assert.equal(G.STARTERS.length, 12);
  assert.ok(!l1.includes("c:hedgehog"));
  assert.ok(G.unlockedIds(2, {}).includes("c:hedgehog"));
  assert.ok(l1.includes("m:race") && l1.includes("m:timetrial") && l1.includes("m:ghost"));
  assert.ok(!l1.includes("m:blitz"));
  assert.ok(G.unlockedIds(3, {}).includes("m:blitz"));
  assert.ok(!G.unlockedIds(30, {}).includes("m:bingo"));
  assert.ok(l1.includes("ti:rookie"));
  assert.ok(!l1.includes("ti:comeback"));
  assert.ok(G.unlockedIds(1, { counts: { redeem: 1 } }).includes("ti:comeback"));
  assert.ok(G.unlockedIds(1, { bestStreak: 30 }).includes("ti:unstoppable"));
  const d = G.describeUnlocks(["c:hedgehog", "m:blitz", "h:tophat"]);
  assert.deepEqual(d.map((x) => x[1]), ["Hedgehog", "Blitz", "Top hat"]);
});

test("creature stages", () => {
  assert.deepEqual([1, 4, 5, 9, 10, 19, 20, 30].map(G.stageFor), [1, 1, 2, 2, 3, 3, 4, 4]);
});

test("age handicap: younger player gets a capped multiplier", () => {
  const T = { id: "t", age: 12 }, W = { id: "w", age: 10 }, M = { id: "m", age: 8 }, D = { id: "d", adult: true, age: 0 };
  assert.deepEqual(G.handicaps(T, W, {}), { t: 1, w: 1.16 });
  assert.deepEqual(G.handicaps(T, M, {}), { t: 1, m: 1.32 });
  assert.deepEqual(G.handicaps(M, D, {}), { m: 1.5, d: 1 });
  assert.deepEqual(G.handicaps(T, { id: "x", age: 12 }, {}), { t: 1, x: 1 });
  assert.deepEqual(G.handicaps(T, M, { game: { battles: { handicapPerYear: 0.1, handicapMax: 1.2 } } }), { t: 1, m: 1.2 });
});

test("quiet hours wrap past midnight", () => {
  assert.equal(G.inQuietHours("21:00", {}), true);
  assert.equal(G.inQuietHours("06:59", {}), true);
  assert.equal(G.inQuietHours("07:00", {}), false);
  assert.equal(G.inQuietHours("12:00", {}), false);
  const day = { game: { battles: { quietStart: "13:00", quietEnd: "15:00" } } };
  assert.equal(G.inQuietHours("14:00", day), true);
  assert.equal(G.inQuietHours("16:00", day), false);
  assert.equal(G.inQuietHours("21:00", { game: { battles: { quietStart: "00:00", quietEnd: "00:00" } } }), false);
});

test("streaks, freezes, and milestones", () => {
  const ids = ["a", "b"];
  const log = { "2026-09-20": ["a", "b"], "2026-09-21": ["a", "b"], "2026-09-22": ["a"], "2026-09-23": ["a", "b"], "2026-09-24": ["a", "b"] };
  assert.equal(G.streak(log, ids, "2026-09-24", []), 2);
  assert.equal(G.streak(log, ids, "2026-09-25", []), 2, "today not done yet keeps yesterday's streak");
  assert.equal(G.streak(log, ids, "2026-09-26", []), 0);
  assert.equal(G.streak(log, ids, "2026-09-24", ["2026-09-22"]), 5, "a frozen day bridges the gap");
  assert.equal(G.bestStreak(log, ids, []), 2);
  assert.equal(G.bestStreak(log, ids, ["2026-09-22"]), 5);
  assert.equal(G.streak({}, [], "2026-09-24", []), 0, "no checklist items means no streak");
  const long = {};
  for (let i = 0; i < 8; i++) long[G.addDays("2026-09-01", i)] = ["a", "b"];
  const ms = G.streakMilestones(long, ids, []);
  assert.deepEqual(ms.map((m) => m.key), ["streak3:2026-09-01", "streak7:2026-09-01"]);
  assert.equal(ms[1].date, "2026-09-07");
});

test("chore XP: effort-based, chore of the day doubles, streak boost", () => {
  assert.equal(G.baseChoreXp({ mult: 1 }), 10);
  assert.equal(G.baseChoreXp({ mult: 2 }), 20);
  assert.equal(G.choreXp({ mult: 2 }, { cotd: true }), 40);
  assert.equal(G.choreXp({ mult: 1 }, { boost: 1.25 }), 13);
  assert.equal(G.streakBoost({}, 6), 1);
  assert.equal(G.streakBoost({}, 7), 1.25);
  assert.equal(G.streakBoost({ game: { streakMultiplier: { enabled: false } } }, 30), 1);
});

test("chore of the day: deterministic, prefers Anyone chores, honors a same-day pin", () => {
  const chores = [
    { id: "a", kind: "family", assign: "pool" }, { id: "b", kind: "family", assign: "pool" },
    { id: "mine", kind: "family", assign: "k1" }, { id: "pr1", kind: "pr" },
  ];
  const d = G.choreOfDay(chores, "2026-09-28", {});
  assert.ok(["a", "b"].includes(d));
  assert.equal(G.choreOfDay(chores, "2026-09-28", {}), d);
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(G.choreOfDay(chores, G.addDays("2026-09-01", i), {}));
  assert.deepEqual([...seen].sort(), ["a", "b"], "rotates between Anyone chores");
  const pinned = { game: { choreOfDay: { pin: { date: "2026-09-28", choreId: "mine" } } } };
  assert.equal(G.choreOfDay(chores, "2026-09-28", pinned), "mine");
  assert.equal(G.choreOfDay(chores, "2026-09-29", pinned), G.choreOfDay(chores, "2026-09-29", {}), "pin only lasts its day");
  assert.equal(G.choreOfDay(chores, "2026-09-28", { game: { choreOfDay: { enabled: false } } }), null);
  assert.equal(G.choreOfDay([], "2026-09-28", {}), null);
});

test("badges", () => {
  const none = G.badgeList({ chores: 0, goalHits: 0, bestStreak: 0, redemptions: 0, saved: 0, invest: 0, give: 0, bought: 0 });
  assert.equal(none.filter((b) => b[3]).length, 0);
  const some = G.badgeList({ chores: 50, goalHits: 1, bestStreak: 7, redemptions: 0, saved: 0, invest: 0, give: 0, bought: 0, wins: 1 });
  assert.deepEqual(some.filter((b) => b[3]).map((b) => b[0]), ["first", "fifty", "goal1", "streak7", "win1"]);
});

const T0 = 1_000_000;
const e = (t, choreId = "x", status = "ok") => ({ t, choreId, status });

test("race: first to cross wins, with the handicap applied", () => {
  const b = { mode: "race", players: ["old", "young"], params: { n: 3 }, handicap: { old: 1, young: 1.5 }, startAt: T0, endAt: T0 + 1e6 };
  const entries = { old: [e(T0 + 10), e(T0 + 20), e(T0 + 30)], young: [e(T0 + 5), e(T0 + 25)] };
  // young reaches 2 × 1.5 = 3 at T0+25, before old's third chore at T0+30
  assert.deepEqual(G.decide(b, entries, [], false), { winner: "young", tie: false, reason: "Finished first" });
  assert.equal(G.decide(b, { old: [e(T0 + 10)], young: [] }, [], false), null, "undecided while running");
  const before = { old: [e(T0 - 5), e(T0 + 10)], young: [e(T0 + 10, "x", "reversed")] };
  assert.deepEqual(G.battleScores(b, before, []), { old: { raw: 1, adj: 1 }, young: { raw: 0, adj: 0 } }, "ignores old and reversed entries");
  assert.equal(G.decide(b, before, [], true).winner, "old");
  assert.equal(G.decide(b, { old: [], young: [] }, [], true).noContest, true);
});

test("blitz: most XP when time is up", () => {
  const chores = [{ id: "big", mult: 2 }, { id: "x", mult: 1 }];
  const b = { mode: "blitz", players: ["a", "c"], params: {}, handicap: { a: 1, c: 1 }, startAt: T0, endAt: T0 + 100 };
  const entries = { a: [e(T0 + 1, "big")], c: [e(T0 + 1), e(T0 + 2)] };
  assert.equal(G.decide(b, entries, chores, false), null);
  assert.equal(G.decide(b, entries, chores, true).tie, true);
  assert.equal(G.decide(b, { a: [e(T0 + 1, "big")], c: [e(T0 + 1)] }, chores, true).winner, "a");
});

test("time trial and ghost race", () => {
  const b = { mode: "timetrial", players: ["a", "c"], handicap: { a: 1, c: 1.2 }, attempts: { a: { ms: 100000 }, c: { ms: 115000 } } };
  // c's adjusted time is 115000 / 1.2 ≈ 95833, faster than a
  assert.equal(G.decide(b, {}, [], false).winner, "c");
  assert.equal(G.decide({ ...b, attempts: { a: { ms: 1000 } } }, {}, [], false), null, "waits for both");
  assert.equal(G.decide({ ...b, attempts: { a: { ms: 1000 } } }, {}, [], true).winner, "a");
  assert.equal(G.decide({ ...b, attempts: { a: { ms: 1000 }, c: { startAt: 1, void: "x" } } }, {}, [], false).winner, "a");
  assert.equal(G.decide({ ...b, attempts: {} }, {}, [], true).noContest, true);
  const g = { mode: "ghost", players: ["a"], pb: 90000, attempts: { a: { ms: 80000 } } };
  assert.equal(G.decide(g, {}, [], false).winner, "a");
  assert.equal(G.decide({ ...g, attempts: { a: { ms: 95000 } } }, {}, [], false).lost, true);
  assert.equal(G.decide({ ...g, pb: null }, {}, [], false).record, true);
  assert.equal(G.decide({ ...g, attempts: { a: { startAt: 1 } } }, {}, [], false), null);
});

test("battle XP: winner, tie, loss, and nothing for not trying", () => {
  const b = { mode: "race", players: ["a", "c"], scores: { a: { raw: 3 }, c: { raw: 1 } } };
  assert.deepEqual(G.battleXp(b, { winner: "a" }), { a: 40, c: 15 });
  assert.deepEqual(G.battleXp({ ...b, scores: { a: { raw: 3 }, c: { raw: 0 } } }, { winner: "a" }), { a: 40, c: 0 });
  assert.deepEqual(G.battleXp(b, { tie: true }), { a: 25, c: 25 });
  assert.deepEqual(G.battleXp(b, { noContest: true }), {});
  assert.deepEqual(G.battleXp({ mode: "ghost", players: ["a"] }, { winner: "a", record: true }), { a: 25 });
  assert.deepEqual(G.battleXp({ mode: "ghost", players: ["a"] }, { lost: true, winner: null }), { a: 15 });
});
