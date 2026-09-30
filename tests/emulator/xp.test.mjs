import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as G from "../../public/game.js";
import { doc, setDoc } from "firebase/firestore";
import {
  CONFIG, db, reset, kidClient, parentClient, closeAll, waitFor, quiet, xpOf, eventKeys, today, rejects,
} from "./helpers.mjs";

after(closeAll);

async function weekDocOf(kidId) {
  const s = await db.collection("weeks").where("kidId", "==", kidId).get();
  return s.docs[0];
}

test("a chore earns effort-based XP plus the first-chore badge; reversing takes the chore XP back", async () => {
  await reset();
  const k1 = await kidClient("k1");
  await k1.call("completeChore", { kidId: "k1", choreId: "big" });
  const x = await waitFor(async () => { const x = await xpOf("k1"); return x && x.total === G.XP.chore * 2 + G.XP.badge && x; }, { msg: "double-size chore XP + first badge" });
  assert.equal(x.counts.chore, 1);
  assert.equal(x.maxLevel, 1);
  const keys = await eventKeys("k1");
  assert.ok(keys.some((k) => k.startsWith("chore:")));
  assert.ok(keys.includes("badge:first"));

  // A parent reverses the chore the same way the app does (rewrite the week doc).
  const w = await weekDocOf("k1");
  const data = w.data();
  data.entries[0].status = "reversed";
  await w.ref.set(data);
  const x2 = await waitFor(async () => { const x = await xpOf("k1"); return x.total === G.XP.badge && x; }, { msg: "chore XP removed" });
  assert.equal(x2.counts.chore, 0);
  assert.equal(x2.maxLevel, 1);

  // Restoring gives it back.
  data.entries[0].status = "ok";
  await w.ref.set(data);
  await waitFor(async () => (await xpOf("k1")).total === G.XP.chore * 2 + G.XP.badge, { msg: "chore XP restored" });
});

test("the same chore pays the same XP no matter the pay rate", async () => {
  await reset();
  const k1 = await kidClient("k1"), k3 = await kidClient("k3");
  await k1.call("completeChore", { kidId: "k1", choreId: "c1" });
  await k3.call("completeChore", { kidId: "k3", choreId: "c1" });
  await waitFor(async () => (await xpOf("k1"))?.total === G.XP.chore + G.XP.badge && (await xpOf("k3"))?.total === G.XP.chore + G.XP.badge, { msg: "same XP each" });
});

test("chore limits: a max per person a day, and family-wide maxes per day and per week that count grown-ups too", async () => {
  const chores = [...CONFIG.chores,
    { id: "each", kind: "family", name: "Vacuum", mult: 1, limit: 1, assign: "pool" },
    { id: "fam", kind: "family", name: "Sweep porch", mult: 1, limit: 5, familyLimit: 2, assign: "pool" },
    { id: "wk", kind: "family", name: "Mow", mult: 1, limit: 5, weekLimit: 2, assign: "pool" }];
  await reset({ ...CONFIG, chores });
  const k1 = await kidClient("k1"), k2 = await kidClient("k2"), k3 = await kidClient("k3"), dad = await parentClient("dad@test.com");
  // Max per person per day: everyone gets their own count.
  await k1.call("completeChore", { kidId: "k1", choreId: "each" });
  await rejects(k1.call("completeChore", { kidId: "k1", choreId: "each" }), /max per person/);
  await k2.call("completeChore", { kidId: "k2", choreId: "each" });
  await dad.call("completeChore", { kidId: "dad", choreId: "each" });
  // Max per family per day: a grown-up's chore uses up the family's count too.
  await k1.call("completeChore", { kidId: "k1", choreId: "fam" });
  await dad.call("completeChore", { kidId: "dad", choreId: "fam" });
  await rejects(k2.call("completeChore", { kidId: "k2", choreId: "fam" }), /done for today/);
  // Max per family per week, whoever does it or logs it.
  await k1.call("completeChore", { kidId: "k1", choreId: "wk" });
  await k2.call("completeChore", { kidId: "k2", choreId: "wk" });
  await rejects(k3.call("completeChore", { kidId: "k3", choreId: "wk" }), /done for this week/);
  await rejects(dad.call("completeChore", { kidId: "k3", choreId: "wk" }), /done for this week/);
  await rejects(dad.call("completeChore", { kidId: "dad", choreId: "wk" }), /done for this week/);
  const w = await db.collection("weeks").where("kidId", "==", "dad").get();
  assert.deepEqual(w.docs[0].data().entries.map((e) => e.choreId).sort(), ["each", "fam"]);
  // Let the XP triggers from those chores finish before the next test clears the database.
  await waitFor(async () => (await xpOf("k1"))?.counts?.chore === 3 && (await xpOf("k2"))?.counts?.chore === 2 && (await xpOf("dad"))?.counts?.chore === 2, { msg: "chores counted" });
  await Promise.all(["k1", "k2", "dad"].map((id) => quiet(`xp/${id}`)));
});

test("morning badges: chores before 9 AM are counted, and 3 or 5 in one day earn Early bird and Rise and shine", async () => {
  await reset();
  const k2 = await kidClient("k2");
  await k2.call("completeChore", { kidId: "k2", choreId: "c2" });
  await waitFor(async () => (await xpOf("k2"))?.total === G.XP.chore + G.XP.badge, { msg: "one chore + first badge" });
  // That chore was logged just now, so it counts as a morning chore only when this test runs before 9 AM in Denver.
  const d = today();
  const nowEarly = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", hourCycle: "h23" }).format(new Date())) < G.EARLY_HOUR ? 1 : 0;
  // An offset of -06:30 sits between Denver's daylight (-06:00) and standard (-07:00) time, so 7:00 here is 6:30 or 7:30 AM in Denver on the same date.
  const at = (h, i) => ({ id: "m" + i, t: Date.parse(`${d}T${String(h).padStart(2, "0")}:00:00-06:30`), type: "chore", choreId: "c1", name: "Sweep", amount: 0.25, date: d, status: "ok" });
  const w = await weekDocOf("k2");
  const base = w.data();
  await w.ref.set({ ...base, entries: [...base.entries, at(7, 1), at(7, 2), at(8, 3)] });
  const x = await waitFor(async () => { const x = await xpOf("k2"); return x && x.total === G.XP.chore * 4 + G.XP.badge * 2 && x; }, { msg: "4 chores + first chore + Early bird" });
  assert.equal(x.counts.early, 3 + nowEarly);
  assert.equal(x.earlyBest, 3 + nowEarly);
  assert.ok((await eventKeys("k2")).includes("badge:early3"));
  // Two more before 9 AM, and one in the evening that is a chore but not a morning one.
  await w.ref.set({ ...base, entries: [...base.entries, at(7, 1), at(7, 2), at(8, 3), at(8, 4), at(8, 5), at(20, 6)] });
  const x2 = await waitFor(async () => { const x = await xpOf("k2"); return x && x.total === G.XP.chore * 7 + G.XP.badge * 3 && x; }, { msg: "7 chores + first chore + Early bird + Rise and shine" });
  assert.equal(x2.counts.early, 5 + nowEarly);
  assert.equal(x2.earlyBest, 5 + nowEarly);
  assert.ok((await eventKeys("k2")).includes("badge:early5"));
});

test("chore of the day pays double", async () => {
  await reset({ ...CONFIG, game: { ...CONFIG.game, choreOfDay: { enabled: true, pin: { date: today(), choreId: "c2" } } } });
  const k2 = await kidClient("k2");
  await k2.call("completeChore", { kidId: "k2", choreId: "c2" });
  await waitFor(async () => (await xpOf("k2"))?.total === G.XP.chore * 2 + G.XP.badge, { msg: "double XP + first badge" });
});

test("daily checklist pays once per day, ignores backdating, and streak milestones pay", async () => {
  await reset();
  const k2 = await kidClient("k2");
  await setDoc(doc(k2.db, "prefs", "k2"), { prLog: { [today()]: ["p1", "p2"] } }, { merge: true });
  await waitFor(async () => (await xpOf("k2"))?.total === G.XP.checklist, { msg: "checklist XP" });
  // Unchecking and re-checking doesn't pay twice.
  await setDoc(doc(k2.db, "prefs", "k2"), { prLog: { [today()]: ["p1"] } }, { merge: true });
  await setDoc(doc(k2.db, "prefs", "k2"), { prLog: { [today()]: ["p1", "p2"] } }, { merge: true });
  // A day long ago doesn't pay.
  await setDoc(doc(k2.db, "prefs", "k2"), { prLog: { [today(-20)]: ["p1", "p2"] } }, { merge: true });
  assert.equal((await quiet("xp/k2")).total, G.XP.checklist);

  // A 7-day streak ending today pays the 7-day milestone and turns on the ×1.25 boost.
  const log = {};
  for (let i = 0; i < 7; i++) log[today(-i)] = ["p1", "p2"];
  await db.doc("prefs/k2").set({ prLog: log });
  const x = await waitFor(async () => { const x = await xpOf("k2"); return x.counts.streak >= 1 && x; }, { msg: "streak milestone" });
  const keys = await eventKeys("k2");
  assert.ok(keys.includes(`streak7:${today(-6)}`));
  assert.ok(keys.includes(`pr:${today(-1)}`));
  assert.equal(x.bestStreak, 7);
  await quiet("xp/k2");
  const before = (await xpOf("k2")).total;
  await k2.call("completeChore", { kidId: "k2", choreId: "c1" });
  await waitFor(async () => (await xpOf("k2")).total === before + Math.round(G.XP.chore * G.GAME_DEFAULTS.streakMultiplier.mult) + G.XP.badge, { msg: "boosted chore XP + first badge" });
});

test("security rules: locked creatures and cosmetics can't be picked; xp can't be written", async () => {
  await reset();
  const k1 = await kidClient("k1");
  const prefs = doc(k1.db, "prefs", "k1");
  await setDoc(prefs, { creature: "fox" }, { merge: true });
  await rejects(setDoc(prefs, { creature: "hedgehog" }, { merge: true }), /permission|PERMISSION/i);
  await rejects(setDoc(prefs, { equipped: { hat: "tophat" } }, { merge: true }), /permission|PERMISSION/i);
  await rejects(setDoc(prefs, { equipped: { rocket: "x" } }, { merge: true }), /permission|PERMISSION/i);
  await rejects(setDoc(doc(k1.db, "xp", "k1"), { total: 99999 }), /permission|PERMISSION/i);
  await rejects(setDoc(doc(k1.db, "battles", "x"), { mode: "race" }), /permission|PERMISSION/i);
  await db.doc("xp/k1").set({ total: 500, maxLevel: 3, unlocked: ["c:hedgehog", "h:tophat"] });
  await setDoc(prefs, { creature: "hedgehog", equipped: { hat: "tophat", theme: "" } }, { merge: true });
  // Other kids still can't write this kid's prefs.
  const k2 = await kidClient("k2");
  await rejects(setDoc(doc(k2.db, "prefs", "k1"), { creature: "fox" }, { merge: true }), /permission|PERMISSION/i);
});

test("backfill scores history once, levels up, and is safe to repeat", async () => {
  await reset();
  const wk = "2026-08-03";
  const entries = Array.from({ length: 30 }, (_, i) => ({ id: "h" + i, t: 1e12 + i, type: "chore", choreId: "c1", name: "Sweep", amount: 0.25, date: wk, status: "ok" }));
  await db.doc(`weeks/${wk}_k2`).set({
    kidId: "k2", week: wk, goal: 5, closed: true, cashout: { met: true }, entries,
    deductions: [{ id: "d1", amount: 0.25, reason: "Attitude", status: "redeemed" }],
  });
  await db.doc("bank/k2").set({ stats: { chores: 30, goalHits: 1, redemptions: 1 }, goalBal: {}, invest: 0, give: 0, archived: [] });
  const parent = await parentClient();
  await parent.call("backfillXp", {});
  const x = await quiet("xp/k2", 2500);
  // 30 chores + goal + earn-back + 4 badges (first chore, 10 chores, goal getter, comeback)
  const expected = 30 * G.XP.chore + G.XP.goal + G.XP.redeem + 4 * G.XP.badge;
  assert.equal(x.total, expected);
  assert.equal(x.maxLevel, G.levelFor(expected));
  assert.equal(x.levelUp.level, G.levelFor(expected));
  for (const id of G.unlockedIds(G.levelFor(expected), {})) assert.ok(x.unlocked.includes(id), `${id} unlocked`);
  assert.ok(x.unlocked.includes("ti:comeback"));
  await parent.call("backfillXp", {});
  assert.equal((await quiet("xp/k2")).total, expected);
  // Kids can't run it.
  const k2 = await kidClient("k2");
  await rejects(k2.call("backfillXp", {}), /Parents only/);
});

test("a streak freeze covers a missed day, and comes back if the day gets finished late", async () => {
  await reset();
  await db.doc("prefs/k3").set({ prLog: { [today(-3)]: ["p1", "p2"], [today(-2)]: ["p1", "p2"] } });
  await quiet("prefs/k3");
  await db.doc("xp/k3").set({ total: 0, maxLevel: 1, freezes: 1, frozenDates: [], counts: {} });
  const parent = await parentClient();
  await parent.call("testHooks", { run: "freezes" });
  const x = await xpOf("k3");
  assert.equal(x.freezes, 0);
  assert.deepEqual(x.frozenDates, [today(-1)]);
  assert.equal(x.notice.type, "freeze");
  // Running again doesn't spend another.
  await parent.call("testHooks", { run: "freezes" });
  assert.equal((await xpOf("k3")).frozenDates.length, 1);
  // Finishing yesterday late refunds it.
  await db.doc("prefs/k3").set({ prLog: { [today(-1)]: ["p1", "p2"] } }, { merge: true });
  const x2 = await waitFor(async () => { const x = await xpOf("k3"); return x.freezes === 1 && x; }, { msg: "refund" });
  assert.deepEqual(x2.frozenDates, []);
});

test("a creature added later works right away for anyone already past its level", async () => {
  await reset();
  const k1 = await kidClient("k1"), k2 = await kidClient("k2");
  // Saved unlock lists from before the cat existed.
  await db.doc("xp/k1").set({ total: 1500, maxLevel: 6, unlocked: ["c:hedgehog"] });
  await db.doc("xp/k2").set({ total: 500, maxLevel: 4, unlocked: [] });
  await setDoc(doc(k1.db, "prefs", "k1"), { creature: "cat" }, { merge: true });
  await rejects(setDoc(doc(k2.db, "prefs", "k2"), { creature: "cat" }, { merge: true }), /permission|PERMISSION/i);
  await rejects(setDoc(doc(k1.db, "prefs", "k1"), { creature: "peacock" }, { merge: true }), /permission|PERMISSION/i);
  await rejects(setDoc(doc(k1.db, "prefs", "k1"), { creature: "made-up" }, { merge: true }), /permission|PERMISSION/i);
});

test("a chore finished in full-screen mode keeps how long it took", async () => {
  await reset();
  const k1 = await kidClient("k1");
  await k1.call("completeChore", { kidId: "k1", choreId: "c1", ms: 754000 });
  await k1.call("completeChore", { kidId: "k1", choreId: "c2", ms: 99 * 3600 * 1000 }); // nonsense times are dropped
  const s = await db.collection("weeks").where("kidId", "==", "k1").get();
  const entries = s.docs.flatMap((d) => d.data().entries);
  assert.equal(entries.find((e) => e.choreId === "c1").ms, 754000);
  assert.equal(entries.find((e) => e.choreId === "c2").ms, undefined);
  await waitFor(async () => (await xpOf("k1"))?.counts?.chore === 2, { msg: "chore XP" });
  await quiet("xp/k1");
});
