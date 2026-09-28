import { test, after } from "node:test";
import assert from "node:assert/strict";
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
  const x = await waitFor(async () => { const x = await xpOf("k1"); return x && x.total === 45 && x; }, { msg: "20 chore XP + 25 badge XP" });
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
  const x2 = await waitFor(async () => { const x = await xpOf("k1"); return x.total === 25 && x; }, { msg: "chore XP removed" });
  assert.equal(x2.counts.chore, 0);
  assert.equal(x2.maxLevel, 1);

  // Restoring gives it back.
  data.entries[0].status = "ok";
  await w.ref.set(data);
  await waitFor(async () => (await xpOf("k1")).total === 45, { msg: "chore XP restored" });
});

test("the same chore pays the same XP no matter the pay rate", async () => {
  await reset();
  const k1 = await kidClient("k1"), k3 = await kidClient("k3");
  await k1.call("completeChore", { kidId: "k1", choreId: "c1" });
  await k3.call("completeChore", { kidId: "k3", choreId: "c1" });
  await waitFor(async () => (await xpOf("k1"))?.total === 35 && (await xpOf("k3"))?.total === 35, { msg: "35 XP each" });
});

test("chore of the day pays double", async () => {
  await reset({ ...CONFIG, game: { ...CONFIG.game, choreOfDay: { enabled: true, pin: { date: today(), choreId: "c2" } } } });
  const k2 = await kidClient("k2");
  await k2.call("completeChore", { kidId: "k2", choreId: "c2" });
  await waitFor(async () => (await xpOf("k2"))?.total === 45, { msg: "20 double XP + 25 badge" });
});

test("daily checklist pays once per day, ignores backdating, and streak milestones pay", async () => {
  await reset();
  const k2 = await kidClient("k2");
  await setDoc(doc(k2.db, "prefs", "k2"), { prLog: { [today()]: ["p1", "p2"] } }, { merge: true });
  await waitFor(async () => (await xpOf("k2"))?.total === 5, { msg: "checklist XP" });
  // Unchecking and re-checking doesn't pay twice.
  await setDoc(doc(k2.db, "prefs", "k2"), { prLog: { [today()]: ["p1"] } }, { merge: true });
  await setDoc(doc(k2.db, "prefs", "k2"), { prLog: { [today()]: ["p1", "p2"] } }, { merge: true });
  // A day long ago doesn't pay.
  await setDoc(doc(k2.db, "prefs", "k2"), { prLog: { [today(-20)]: ["p1", "p2"] } }, { merge: true });
  assert.equal((await quiet("xp/k2")).total, 5);

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
  await waitFor(async () => (await xpOf("k2")).total === before + 13 + 25, { msg: "boosted chore XP (13) + first badge" });
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
  // 30 × 10 + 50 goal + 20 earn-back + badges (first chore, goal getter, comeback) 75 = 445 → level 3
  assert.equal(x.total, 445);
  assert.equal(x.maxLevel, 3);
  assert.equal(x.levelUp.level, 3);
  assert.ok(x.unlocked.includes("c:sloth") && x.unlocked.includes("m:blitz"));
  assert.ok(x.unlocked.includes("ti:comeback"));
  await parent.call("backfillXp", {});
  assert.equal((await quiet("xp/k2")).total, 445);
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
