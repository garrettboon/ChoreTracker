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

test("unlocks: starters free, new creatures and modes by level", () => {
  const l1 = G.unlockedIds(1, {});
  for (const s of G.STARTERS) assert.ok(l1.includes("c:" + s));
  assert.equal(G.STARTERS.length, 13);
  assert.ok(!l1.includes("c:hedgehog"));
  assert.ok(G.unlockedIds(2, {}).includes("c:hedgehog"));
  assert.ok(l1.includes("m:race") && l1.includes("m:timetrial") && l1.includes("m:ghost"));
  assert.ok(!l1.includes("m:blitz"));
  assert.ok(G.unlockedIds(3, {}).includes("m:blitz"));
  assert.ok(!G.unlockedIds(4, {}).includes("m:bingo"));
  assert.ok(G.unlockedIds(5, {}).includes("m:bingo"));
  assert.ok(G.unlockedIds(30, {}).includes("m:wildcard"));
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
  const none = G.badgeList({});
  assert.equal(none.filter((b) => b[3]).length, 0, "nothing earned from nothing");
  assert.equal(new Set(none.map((b) => b[0])).size, none.length, "ids are unique");
  assert.equal(new Set(none.map((b) => b[1])).size, none.length, "emoji are unique");
  assert.ok(none.every((b) => b[4]), "every badge says how to earn it");
  for (const id of ["first", "fifty", "goal1", "goal5", "streak7", "comeback", "saved25", "invest100", "give10", "bought", "win1", "win10", "giant"]) {
    assert.ok(none.some((b) => b[0] === id), `original badge ${id} kept`);
  }
  const some = G.badgeList({ chores: 50, goalHits: 1, bestStreak: 7, wins: 1, level: 5, quests: 1 });
  assert.deepEqual(some.filter((b) => b[3]).map((b) => b[0]),
    ["first", "chores10", "fifty", "streak3", "streak7", "goal1", "level5", "quest1", "win1"]);
  // Morning badges: the most chores before 9 AM in one day, and chores before 9 AM in all.
  assert.deepEqual(G.badgeList({ earlyBest: 3, early: 24 }).filter((b) => b[3]).map((b) => b[0]), ["early3"]);
  assert.deepEqual(G.badgeList({ earlyBest: 5, early: 25 }).filter((b) => b[3]).map((b) => b[0]), ["early3", "early5", "early25"]);
  const m = (date, hour, status = "ok") => ({ date, hour, status });
  assert.equal(G.bestMorning([m("2026-09-28", 7), m("2026-09-28", 8), m("2026-09-28", G.EARLY_HOUR), m("2026-09-29", 6), m("2026-09-28", 8, "reversed")]), 2,
    "counts one day's chores before 9 AM, not 9 AM itself or reversed ones");
  assert.equal(G.bestMorning([]), 0);
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
  assert.deepEqual(G.battleXp(b, { winner: "a" }), { a: G.XP.win, c: G.XP.loss });
  assert.deepEqual(G.battleXp({ ...b, scores: { a: { raw: 3 }, c: { raw: 0 } } }, { winner: "a" }), { a: G.XP.win, c: 0 });
  assert.deepEqual(G.battleXp(b, { tie: true }), { a: G.XP.tie, c: G.XP.tie });
  assert.deepEqual(G.battleXp(b, { noContest: true }), {});
  assert.deepEqual(G.battleXp({ mode: "ghost", players: ["a"] }, { winner: "a", record: true }), { a: G.XP.ghostRecord });
  assert.deepEqual(G.battleXp({ mode: "ghost", players: ["a"] }, { lost: true, winner: null }), { a: G.XP.loss });
});

test("territory counts only Anyone chores, with the Wildcard twist doubling one chore", () => {
  const chores = [{ id: "pool1", assign: "pool" }, { id: "pool2", assign: "pool" }, { id: "mine", assign: "a" }];
  const b = { mode: "territory", players: ["a", "c"], handicap: { a: 1, c: 1 }, startAt: T0, endAt: T0 + 100 };
  const entries = { a: [e(T0 + 1, "pool1"), e(T0 + 2, "mine")], c: [e(T0 + 1, "pool2"), e(T0 + 3, "pool2")] };
  assert.deepEqual(G.battleScores(b, entries, chores), { a: { raw: 1, adj: 1 }, c: { raw: 2, adj: 2 } });
  assert.equal(G.decide(b, entries, chores, false), null);
  assert.equal(G.decide(b, entries, chores, true).winner, "c");
  const twisted = { ...b, twist: { choreId: "pool1" } };
  assert.equal(G.decide(twisted, entries, chores, true).tie, true);
});

test("chore bingo: card, free squares, first line wins", () => {
  const card = G.bingoCard(["a", "b", "c", "d", "e", "f", "g", "h", "i"], "seed");
  assert.equal(card.length, 9);
  assert.deepEqual([...card].sort(), ["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
  assert.deepEqual(G.bingoCard(["x", "y"], "s").length, 9, "few chores repeat to fill the card");
  const free = G.bingoFree({ id: "old", age: 12 }, { id: "young", age: 8 }, {}, "s");
  assert.deepEqual(Object.keys(free), ["young"]);
  assert.equal(free.young[0], 4);
  assert.equal(free.young.length, 2, "4+ years apart gets a second free square");
  assert.deepEqual(G.bingoFree({ id: "a", age: 10 }, { id: "b", age: 10 }, {}, "s"), {});
  const b = { mode: "bingo", players: ["p", "q"], params: { card: ["a", "b", "c", "d", "e", "f", "g", "h", "i"], free: { q: [4] } }, startAt: T0, endAt: T0 + 1000 };
  // q has the center free, so e+... q needs d,f for the middle row. p needs a,b,c for the top row.
  const entries = { p: [e(T0 + 1, "a"), e(T0 + 2, "b"), e(T0 + 5, "c")], q: [e(T0 + 1, "d"), e(T0 + 3, "f")] };
  assert.deepEqual(G.decide(b, entries, [], false), { winner: "q", tie: false, reason: "Bingo!" });
  assert.equal(G.battleScores(b, entries, []).q.raw, 3);
  assert.equal(G.decide(b, { p: [e(T0 + 1, "a")], q: [] }, [], false), null);
  assert.equal(G.decide(b, { p: [e(T0 + 1, "a")], q: [] }, [], true).tie, true, "the free square counts toward the most squares");
  assert.equal(G.decide(b, { p: [e(T0 + 1, "a"), e(T0 + 2, "i")], q: [] }, [], true).winner, "p");
  assert.equal(G.decide(b, { p: [], q: [] }, [], true).noContest, true, "free squares alone don't count");
});

test("goal showdown score uses the larger of goal and recent average", () => {
  assert.equal(G.showdownScore(5, 5, 2), 1);
  assert.equal(G.showdownScore(5, 1, 5), 1, "a tiny goal doesn't help");
  assert.equal(G.showdownScore(3, 0, 0), 0);
  assert.equal(G.showdownScore(-2, 4, 0), 0);
});

test("baby boss raid: level 1, tiny, one day, never harder, smaller payout", () => {
  const chores = [{ id: "x", mult: 1 }, { id: "big", mult: 2 }];
  assert.equal(G.modeById("babyraid").level, 1);
  assert.equal(G.isRaid("babyraid"), true);
  assert.equal(G.isRaid("race"), false);
  assert.equal(G.babyRaidHp(1), 15);
  assert.equal(G.babyRaidHp(3), 45);
  assert.equal(G.babyBossFor(0).name, "Dust Bunny");
  assert.equal(G.babyBossFor(5).name, "Dust Bunny 2");
  assert.equal(G.babyBossFor(7).tier, 0, "baby bosses never scale up");
  const baby = { mode: "babyraid", players: ["a"], teams: { a: ["a"] }, params: { hp: 15, bossName: "Dust Bunny" }, startAt: T0, endAt: T0 + 100 };
  assert.equal(G.decide(baby, { a: [e(T0 + 1)] }, chores, false), null, "one small chore isn't enough");
  assert.equal(G.decide(baby, { a: [e(T0 + 1, "big")] }, chores, false).winnerSide, "a");
  assert.deepEqual(G.battleXp({ ...baby, scores: { a: { raw: 20 } } }, { winnerSide: "a" }), { a: G.XP.babyRaidWin });
  assert.ok(G.unlockedIds(1, {}).includes("m:babyraid"), "unlocked from level 1");
});

test("team battles: raid and kids vs grown-ups", () => {
  const chores = [{ id: "x", mult: 1 }, { id: "big", mult: 2 }];
  const raid = { mode: "raid", players: ["a", "c"], teams: { a: ["a", "c"] }, params: { hp: 40, bossName: "Sock Goblin" }, startAt: T0, endAt: T0 + 100 };
  assert.equal(G.decide(raid, { a: [e(T0 + 1, "big")], c: [e(T0 + 2)] }, chores, false), null);
  assert.equal(G.decide(raid, { a: [e(T0 + 1, "big")], c: [e(T0 + 2), e(T0 + 3)] }, chores, false).winnerSide, "a");
  assert.equal(G.decide(raid, { a: [e(T0 + 1)], c: [] }, chores, true).lostSide, "a");
  assert.equal(G.raidHp(2, 1, 0), 120);
  assert.equal(G.raidHp(2, 2, 2), 360);
  assert.equal(G.bossFor(0).name, "Sock Goblin");
  assert.equal(G.bossFor(6).name, "Chaos Dragon 3");
  const gu = { mode: "grownups", players: ["k1", "k2", "d"], teams: { a: ["k1", "k2"], b: ["d"] }, teamHandicap: { a: 1.5, b: 1 }, startAt: T0, endAt: T0 + 100 };
  const r = G.decide(gu, { k1: [e(T0 + 1)], k2: [], d: [e(T0 + 1)] }, chores, true);
  assert.equal(r.winnerSide, "a", "kids' 10 XP × 1.5 beats 10");
  assert.equal(G.isWinner(gu, r, "k2"), true);
  assert.equal(G.isWinner(gu, r, "d"), false);
  assert.deepEqual(G.teamHandicaps([{ age: 8 }, { age: 12 }], [{ adult: true }], {}), { a: 1.5, b: 1 });
  const xp = G.battleXp({ ...gu, scores: { k1: { raw: 10 }, k2: { raw: 0 }, d: { raw: 10 } } }, r);
  assert.deepEqual(xp, { k1: G.XP.win, k2: 0, d: G.XP.loss }, "a teammate who did nothing gets nothing");
  assert.deepEqual(G.battleXp({ ...raid, scores: { a: { raw: 10 }, c: { raw: 0 } } }, { winnerSide: "a" }), { a: G.XP.raidWin, c: 0 });
});

test("streak duel and showdown pay double; judge's pick needs a parent", () => {
  const b = { mode: "streakduel", players: ["a", "c"] };
  assert.equal(G.decide(b, {}, [], true), null);
  assert.deepEqual(G.battleXp(b, { winner: "a" }), { a: G.XP.win * 2, c: G.XP.loss * 2 });
  const j = { mode: "judge", players: ["a", "c"], attempts: { a: { entryId: "1" }, c: { entryId: "2" } } };
  assert.equal(G.decide(j, {}, [], true), null, "both did it: waits for the judge");
  assert.equal(G.decide({ ...j, attempts: { a: { entryId: "1" } } }, {}, [], true).winner, "a");
});

test("rewards, family goal, and raises", () => {
  assert.deepEqual(G.rewardSlots({ level: 5, repeat: 5 }, 17), [5, 10, 15]);
  assert.deepEqual(G.rewardSlots({ level: 5, repeat: 0 }, 17), [5]);
  assert.deepEqual(G.rewardSlots({ level: 5 }, 4), []);
  assert.equal(G.nextRewardSlot({ level: 5, repeat: 5 }, 17, [5]), 10);
  assert.equal(G.nextRewardSlot({ level: 5, repeat: 0 }, 17, [5]), null);
  assert.deepEqual(G.familyProgress(1500, { target: 1000, startTotal: 1000 }), { into: 500, target: 1000, frac: 0.5, done: false });
  assert.equal(G.familyProgress(2100, { target: 1000, startTotal: 1000 }).done, true);
  assert.equal(G.familyProgress(10, null), null);
  assert.equal(G.raisesDue(12, 0, 5), 2);
  assert.equal(G.raisesDue(12, 10, 5), 0);
  assert.equal(G.raisesDue(15, 10, 5), 1);
});

test("weekly quests: three per person, stable, and scored from the week's data", () => {
  const q1 = G.weeklyQuests("2026-09-28", "k1").map((q) => q.id);
  assert.equal(q1.length, 3);
  assert.equal(new Set(q1).size, 3);
  assert.deepEqual(G.weeklyQuests("2026-09-28", "k1").map((q) => q.id), q1, "same every time");
  const weeks = new Set();
  for (let i = 0; i < 8; i++) weeks.add(G.weeklyQuests(G.addDays("2026-09-07", i * 7), "k1").map((q) => q.id).join());
  assert.ok(weeks.size > 3, "changes from week to week");
  const chores = [{ id: "a", mult: 1 }, { id: "b", mult: 2 }, { id: "c", mult: 1 }];
  const ctx = {
    entries: [{ date: "d1", choreId: "a", hour: 8 }, { date: "d1", choreId: "b", hour: 10 }, { date: "d1", choreId: "c", hour: 11 }, { date: "d2", choreId: "b", hour: 12 }],
    chores, cotdOf: () => "c", checklistDays: 5, wins: 0, goal: 5, netByFri: 6,
  };
  const val = (id) => G.QUESTS.find((q) => q.id === id).progress(ctx);
  assert.equal(val("variety"), 3);
  assert.equal(val("early"), 1);
  assert.equal(val("ten"), 4);
  assert.equal(val("cotd"), 1);
  assert.equal(val("checklist5"), 5);
  assert.equal(val("goalfri"), 1);
  assert.equal(val("battle"), 0);
  assert.equal(val("big"), 2);
  const st = G.questStatus("2026-09-28", "k1", ctx);
  assert.ok(st.every((q) => q.progress <= q.target));
});

test("security rules list every creature at the same level as game.js", () => {
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  const block = rules.slice(rules.indexOf("function creatureLevels()"), rules.indexOf("function okCreature"));
  const map = Object.fromEntries([...block.matchAll(/'([a-z]+)': (\d+)/g)].map((m) => [m[1], Number(m[2])]));
  assert.deepEqual(map, Object.fromEntries(G.CREATURES.map((c) => [c[0], c[3]])));
});

test("the dog is a free starter", () => {
  assert.ok(G.STARTERS.includes("dog"));
  assert.equal(G.STARTERS.length, 13);
  assert.deepEqual(G.describeUnlocks(["c:dog"])[0].slice(0, 2), ["🐶", "Dog"]);
});

test("the cat unlocks at level 5", () => {
  assert.ok(!G.unlockedIds(4, {}).includes("c:cat"));
  assert.ok(G.unlockedIds(5, {}).includes("c:cat"));
  assert.deepEqual(G.describeUnlocks(["c:cat"])[0].slice(0, 2), ["🐱", "Cat"]);
});

test("a timed run that fails the parent's check earns no XP", () => {
  const b = { mode: "timetrial", players: ["a", "c"], attempts: { a: { ms: 30000 }, c: { ms: 60000 } }, quality: { a: false, c: true } };
  assert.deepEqual(G.battleXp(b, { winner: "c" }), { a: 0, c: G.XP.win });
  assert.deepEqual(G.battleXp({ ...b, quality: { a: true, c: true } }, { winner: "a" }), { a: G.XP.win, c: G.XP.loss });
});

test("battle limits: per person, per day and week, overall and per mode", () => {
  const mon = "2026-09-28", today = "2026-09-30";
  const b = (day, mode, status = "done", extra = {}) => ({ day, mode, status, players: ["a", "c"], ...extra });
  const cfg = (battles) => ({ game: { battles: { dailyCap: 3, weeklyCap: 5, modeLimits: { race: { day: 1, week: 2 }, wildcard: { week: 1 } }, ...battles } } });
  const L = (config, mode, list, who = "a") => G.battleLimit(config, mode, list, who, today, mon);
  assert.equal(L(cfg(), "race", []), null);
  assert.deepEqual(L(cfg(), "race", [b(today, "race")]), { scope: "day", mode: "race", n: 1 });
  assert.equal(L(cfg(), "blitz", [b(today, "race")]), null, "other modes are still open");
  assert.deepEqual(L(cfg(), "race", [b("2026-09-28", "race"), b("2026-09-29", "race")]), { scope: "week", mode: "race", n: 2 });
  assert.equal(L(cfg(), "race", [b("2026-09-27", "race"), b("2026-09-21", "race")]), null, "last week doesn't count");
  assert.equal(L(cfg(), "race", [b(today, "race", "declined"), b(today, "race", "expired"), b(today, "race", "cancelled")]), null, "battles that never happened don't count");
  assert.equal(L(cfg(), "race", [b(today, "race", "done", { players: ["c", "d"] })]), null, "only your own battles count");
  const three = [b(today, "blitz"), b(today, "bingo"), b(today, "judge")];
  assert.deepEqual(L(cfg(), "timetrial", three), { scope: "day", all: true, n: 3 });
  const five = ["2026-09-28", "2026-09-28", "2026-09-29", "2026-09-29", "2026-09-29"].map((d) => b(d, "blitz"));
  assert.deepEqual(L(cfg(), "timetrial", five), { scope: "week", all: true, n: 5 });
  assert.equal(L(cfg({ weeklyCap: 0 }), "timetrial", five), null, "0 means no weekly limit");
  assert.deepEqual(L(cfg(), "wildcard", [b("2026-09-29", "blitz", "done", { wildcard: true })]), { scope: "week", mode: "wildcard", n: 1 }, "wildcards count as Wildcard");
  assert.equal(L(cfg(), "blitz", [b(today, "blitz", "done", { wildcard: true })]), null);
  assert.equal(G.battleLimitText({ scope: "day", all: true, n: 3 }), "You've done 3 battles today. That's the limit.");
  assert.equal(G.battleLimitText({ scope: "week", mode: "race", n: 1 }, "Maggie"), "Maggie has done 1 Race battle this week. That's the limit.");
});
