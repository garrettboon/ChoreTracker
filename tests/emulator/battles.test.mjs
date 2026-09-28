import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG, db, reset, kidClient, parentClient, closeAll, waitFor, quiet, xpOf, eventKeys, battle, rejects,
} from "./helpers.mjs";

after(closeAll);
const H = 3600 * 1000;

test("race: challenge, accept, first to finish wins, loser confirms, XP and badge paid", async () => {
  await reset();
  const k1 = await kidClient("k1"), k2 = await kidClient("k2");
  const { id } = await k1.call("createBattle", { mode: "race", opponent: "k2", n: 2 });
  let b = await battle(id);
  assert.equal(b.status, "pending");
  assert.deepEqual(b.handicap, { k1: 1, k2: 1.16 });
  await rejects(k1.call("respondBattle", { id, accept: true }), /isn't for you/);
  await k2.call("respondBattle", { id, accept: true });
  assert.equal((await battle(id)).status, "active");

  await k1.call("completeChore", { kidId: "k1", choreId: "c1" });
  await waitFor(async () => (await battle(id)).scores?.k1?.raw === 1, { msg: "live score" });
  await k1.call("completeChore", { kidId: "k1", choreId: "c2" });
  b = await waitFor(async () => { const b = await battle(id); return b.status === "confirming" && b; }, { msg: "race decided" });
  assert.equal(b.result.winner, "k1");

  await rejects(k1.call("confirmResult", { id }), /other player or a parent/);
  await k2.call("confirmResult", { id });
  b = await waitFor(async () => { const b = await battle(id); return b.live === false && b; }, { msg: "battle closed" });
  assert.equal(b.status, "done");
  assert.deepEqual(b.xp, { k1: 40, k2: 0 });
  await quiet("xp/k1");
  const keys = await eventKeys("k1");
  assert.ok(keys.includes("battle:" + id));
  assert.ok(keys.includes("badge:win1"));
  assert.equal((await xpOf("k1")).counts.win, 1);
});

test("guardrails: one battle per pair, locked modes, decline cooldown, daily cap", async () => {
  await reset({ ...CONFIG, game: { ...CONFIG.game, battles: { ...CONFIG.game.battles, dailyCap: 2 } } });
  const k1 = await kidClient("k1"), k2 = await kidClient("k2"), k3 = await kidClient("k3");
  const { id } = await k1.call("createBattle", { mode: "race", opponent: "k2" });
  await rejects(k2.call("createBattle", { mode: "race", opponent: "k1" }), /already have a battle/);
  await rejects(k3.call("createBattle", { mode: "blitz", opponent: "k1" }), /Reach level 3/);
  await rejects(k3.call("createBattle", { mode: "bingo", opponent: "k1" }), /isn't ready/);
  await rejects(k3.call("createBattle", { mode: "race", opponent: "k3" }), /Pick someone/);
  await k2.call("respondBattle", { id, accept: false });
  assert.equal((await battle(id)).status, "declined");
  await rejects(k1.call("createBattle", { mode: "race", opponent: "k2" }), /said not now/);
  // Declines don't count toward the cap; two real battles do.
  const a = await k1.call("createBattle", { mode: "race", opponent: "k3" });
  await k1.call("cancelBattle", { id: a.id });
  await k1.call("createBattle", { mode: "timetrial", opponent: "k3", choreId: "c1" });
  await k3.call("createBattle", { mode: "ghost", choreId: "c1" });
  await rejects(k2.call("createBattle", { mode: "race", opponent: "k3" }), /Maggie has done 2 battles today/);
});

test("battles respect quiet hours and the parent's off switches", async () => {
  const battles = (b) => ({ ...CONFIG, game: { ...CONFIG.game, battles: { ...CONFIG.game.battles, ...b } } });
  await reset(battles({ quietStart: "00:00", quietEnd: "23:59" }));
  let k1 = await kidClient("k1");
  await rejects(k1.call("createBattle", { mode: "race", opponent: "k2" }), /asleep/);
  await reset(battles({ modesOff: ["race"] }));
  k1 = await kidClient("k1");
  await rejects(k1.call("createBattle", { mode: "race", opponent: "k2" }), /turned off Race/);
  await reset(battles({ enabled: false }));
  k1 = await kidClient("k1");
  await rejects(k1.call("createBattle", { mode: "race", opponent: "k2" }), /turned off/);
});

test("time trial: timed runs log the chore; very fast results need a parent", async () => {
  await reset();
  const k1 = await kidClient("k1"), k3 = await kidClient("k3");
  await rejects(k1.call("createBattle", { mode: "timetrial", opponent: "k3", choreId: "mine" }), /Anyone chore/);
  const { id } = await k1.call("createBattle", { mode: "timetrial", opponent: "k3", choreId: "c1" });
  await k3.call("respondBattle", { id, accept: true });
  await rejects(k1.call("finishAttempt", { id }), /No run/);
  await k1.call("startAttempt", { id });
  await rejects(k1.call("startAttempt", { id }), /already started/);
  await k3.call("startAttempt", { id });
  await k1.call("finishAttempt", { id });
  assert.equal((await battle(id)).status, "active", "waits for both players");
  await k3.call("finishAttempt", { id });
  let b = await battle(id);
  assert.equal(b.status, "confirming");
  assert.equal(b.result.needsParent, true, "runs under a minute are flagged");
  assert.ok(b.attempts.k1.entryId && b.attempts.k3.entryId, "each run logged a real chore");
  const loser = b.result.winner === "k1" ? k3 : k1; // both runs take about the same time, so usually a tie
  await rejects(loser.call("confirmResult", { id }), /parent has to check/);
  const parent = await parentClient();
  await parent.call("confirmResult", { id, action: "confirm" });
  b = await waitFor(async () => { const b = await battle(id); return b.live === false && b; }, { msg: "closed" });
  assert.equal(b.status, "done");
  if (b.result.tie) assert.deepEqual(b.xp, { k1: 25, k3: 25 });
  else assert.equal(b.xp[b.result.winner], 40);
});

test("ghost race and adults: a parent acts as their own adult profile only", async () => {
  await reset();
  const mom = await parentClient("parent@test.com"), dad = await parentClient("dad@test.com");
  await rejects(mom.call("createBattle", { mode: "ghost", choreId: "c1", as: "dad" }), /Dad's profile/);
  await rejects(dad.call("createBattle", { mode: "ghost", choreId: "c1", as: "nobody" }), /Open a person/);
  const { id } = await dad.call("createBattle", { mode: "ghost", choreId: "c1", as: "dad" });
  assert.equal((await battle(id)).status, "active");
  await dad.call("startAttempt", { id, as: "dad" });
  await dad.call("finishAttempt", { id, as: "dad" });
  let b = await battle(id);
  assert.equal(b.status, "confirming");
  assert.equal(b.result.record, true);
  await rejects(dad.call("confirmResult", { id }), /Another parent/);
  await mom.call("confirmResult", { id, action: "confirm" });
  b = await waitFor(async () => { const b = await battle(id); return b.live === false && b; }, { msg: "closed" });
  assert.deepEqual(b.xp, { dad: 25 });
  const x = await quiet("xp/dad");
  assert.ok(x.pb.c1 >= 0, "personal best saved");
});

test("scheduled tick: challenges expire, timed-out battles finish, results auto-confirm", async () => {
  await reset();
  const k1 = await kidClient("k1"), k2 = await kidClient("k2"), k3 = await kidClient("k3");
  const parent = await parentClient();
  const p = await k1.call("createBattle", { mode: "race", opponent: "k2" });
  await parent.call("testHooks", { run: "tick", now: Date.now() + 3 * H });
  assert.equal((await battle(p.id)).status, "expired");

  await db.doc("xp/k3").set({ total: 300, maxLevel: 3, unlocked: [] });
  const { id } = await k3.call("createBattle", { mode: "blitz", opponent: "k2", windowMin: 30 });
  await k2.call("respondBattle", { id, accept: true });
  await k2.call("completeChore", { kidId: "k2", choreId: "big" });
  await waitFor(async () => (await battle(id)).scores?.k2?.raw === 20, { msg: "blitz score" });
  await parent.call("testHooks", { run: "tick", now: Date.now() + 31 * 60000 });
  let b = await battle(id);
  assert.equal(b.status, "confirming");
  assert.equal(b.result.winner, "k2");
  await parent.call("testHooks", { run: "tick", now: Date.now() + 13 * H });
  b = await battle(id);
  assert.equal(b.status, "done");
  assert.equal(b.result.confirmedBy, "auto");
  assert.equal(b.live, false);
  assert.deepEqual(b.xp, { k3: 0, k2: 40 });

  // A parent can call off a live battle.
  const c = await k1.call("createBattle", { mode: "race", opponent: "k3" });
  await k3.call("respondBattle", { id: c.id, accept: true });
  await rejects(k1.call("cancelBattle", { id: c.id }), /Only a parent/);
  await parent.call("cancelBattle", { id: c.id });
  assert.equal((await battle(c.id)).status, "cancelled");
});
