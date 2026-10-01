import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as G from "../../public/game.js";
import {
  CONFIG, db, reset, kidClient, parentClient, closeAll, today, waitFor, quiet, xpOf, eventKeys, battle, rejects,
} from "./helpers.mjs";

after(closeAll);
const H = 3600 * 1000;

test("challenge, accept, play, loser confirms, XP and badges paid (Room Rush); Race is retired", async () => {
  await reset();
  const k1 = await kidClient("k1"), k2 = await kidClient("k2");
  await rejects(k1.call("createBattle", { mode: "race", opponent: "k2", n: 2 }), /isn't a battle mode any more/);
  const { id } = await k1.call("createBattle", { mode: "roomrush", opponent: "k2", room: "Kitchen", minutes: 1 });
  let b = await battle(id);
  assert.equal(b.status, "pending");
  assert.deepEqual(b.handicap, { k1: 1, k2: 1.16 });
  await rejects(k1.call("respondBattle", { id, accept: true }), /isn't for you/);
  await k2.call("respondBattle", { id, accept: true });
  assert.equal((await battle(id)).status, "active");

  for (const [c, n] of [[k1, 15], [k2, 4]]) {
    const me = c === k1 ? "k1" : "k2";
    await c.call("startAttempt", { id });
    await db.doc(`battles/${id}`).update({ [`attempts.${me}.startAt`]: Date.now() - 60000 });
    await c.call("rushCount", { id, count: n });
  }
  b = await battle(id);
  assert.equal(b.status, "confirming");
  assert.equal(b.result.winner, "k1");

  await rejects(k1.call("confirmResult", { id }), /other player or a parent/);
  await k2.call("confirmResult", { id });
  b = await waitFor(async () => { const b = await battle(id); return b.live === false && b; }, { msg: "battle closed" });
  assert.equal(b.status, "done");
  assert.deepEqual(b.xp, { k1: G.XP.win + G.rushXp(15), k2: G.XP.loss + G.rushXp(4) });
  await waitFor(async () => (await eventKeys("k1")).includes("badge:mode_roomrush"), { msg: "mode badge" });
  await quiet("xp/k1");
  await quiet("xp/k2");
  const keys = await eventKeys("k1");
  assert.ok(keys.includes("battle:" + id));
  assert.ok(keys.includes("badge:win1"));
  assert.equal((await xpOf("k1")).counts.win, 1);
  assert.equal((await xpOf("k1")).counts.win_roomrush, 1);
});

test("when a grown-up plays, the result is final right away: no parent check or confirming", async () => {
  await reset();
  const dad = await parentClient("dad@test.com"), k2 = await kidClient("k2");
  const { id } = await dad.call("createBattle", { mode: "timetrial", opponent: "k2", choreId: "c1", as: "dad" });
  await k2.call("respondBattle", { id, accept: true });
  await dad.call("startAttempt", { id, as: "dad" });
  await k2.call("startAttempt", { id });
  await k2.call("finishAttempt", { id });
  await dad.call("finishAttempt", { id, as: "dad" });
  const b = await waitFor(async () => { const b = await battle(id); return !b.live && b; }, { msg: "settled without a check" });
  assert.equal(b.status, "done");
  assert.equal(b.result.qualityCheck, undefined);
  assert.equal(b.result.confirmedBy, "a grown-up played");
  assert.ok(["dad", "k2"].includes(b.result.winner) || b.result.tie);
  // A result already waiting for a check when a grown-up played is released by the next tick.
  const now = Date.now();
  await db.doc("battles/stuck").set({ mode: "doom", status: "confirming", live: true, players: ["dad", "k2"], challenger: "dad", createdAt: now, day: today(),
    params: { choreId: "c1", choreName: "Sweep" }, handicap: { dad: 1, k2: 1 }, attempts: { dad: { startAt: now - 9e4, ms: 9e4 }, k2: { startAt: now - 6e4, ms: 6e4 } },
    result: { winner: "k2", reason: "Faster time", decidedAt: now, needsParent: true, qualityCheck: true }, names: {} });
  const parent = await parentClient();
  await parent.call("testHooks", { run: "tick", now: now + 1000 });
  const s = await waitFor(async () => { const s = await battle("stuck"); return !s.live && s; }, { msg: "stuck battle released" });
  assert.deepEqual([s.status, s.result.winner, s.result.needsParent], ["done", "k2", false]);
  assert.equal(s.xp.k2, G.XP.win);
  await waitFor(async () => (await eventKeys("k2")).includes("battle:stuck"), { msg: "XP for the released battle" });
  await quiet("xp/k2");
  await quiet("xp/dad");
});

test("mode badges: wins from before per-mode counting are recounted once", async () => {
  await reset();
  // Two battles k3 already won (one a Wildcard that became Bingo) and one k3 lost.
  const old = { status: "done", live: false, challenger: "k1", createdAt: 1, day: today(-3), params: {}, xp: {} };
  await db.doc("battles/old1").set({ ...old, mode: "bingo", wildcard: true, players: ["k1", "k3"], result: { winner: "k3" } });
  await db.doc("battles/old2").set({ ...old, mode: "blitz", players: ["k3", "k2"], result: { winner: "k3" } });
  await db.doc("battles/old3").set({ ...old, mode: "race", players: ["k3", "k2"], result: { winner: "k2" } });
  await db.doc("xp/k3").set({ total: 0, maxLevel: 1, counts: { win: 2, loss: 1 } });
  const k3 = await kidClient("k3");
  await k3.call("completeChore", { kidId: "k3", choreId: "c1" });
  await waitFor(async () => (await eventKeys("k3")).includes("badge:mode_wildcard"), { msg: "recounted badges" });
  const keys = await eventKeys("k3");
  for (const k of ["badge:mode_bingo", "badge:mode_blitz", "badge:mode_wildcard"]) assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes("badge:mode_race"), "a loss earns nothing");
  const x = await waitFor(async () => { const x = await xpOf("k3"); return x.total === G.XP.chore + G.XP.badge * 5 && x; }, { msg: "chore + first chore + win1 + 3 mode badges" });
  assert.equal(x.modeWinsCounted, true);
  assert.deepEqual([x.counts.win_bingo, x.counts.win_wildcard, x.counts.win_blitz], [1, 1, 1]);
  await quiet("xp/k3");
});

test("guardrails: one battle per pair, locked modes, decline cooldown, daily cap", async () => {
  await reset({ ...CONFIG, game: { ...CONFIG.game, battles: { ...CONFIG.game.battles, dailyCap: 2 } } });
  const k1 = await kidClient("k1"), k2 = await kidClient("k2"), k3 = await kidClient("k3");
  const { id } = await k1.call("createBattle", { mode: "roomrush", opponent: "k2" });
  await rejects(k2.call("createBattle", { mode: "roomrush", opponent: "k1" }), /already have a battle/);
  await rejects(k3.call("createBattle", { mode: "blitz", opponent: "k1" }), /Reach level 3/);
  await rejects(k3.call("createBattle", { mode: "bingo", opponent: "k1" }), /Reach level 5/);
  await rejects(k3.call("createBattle", { mode: "nonsense", opponent: "k1" }), /isn't ready/);
  await rejects(k3.call("createBattle", { mode: "roomrush", opponent: "k3" }), /Pick someone/);
  await k2.call("respondBattle", { id, accept: false });
  assert.equal((await battle(id)).status, "declined");
  await rejects(k1.call("createBattle", { mode: "roomrush", opponent: "k2" }), /said not now/);
  // Declines don't count toward the cap; two real battles do.
  const a = await k1.call("createBattle", { mode: "roomrush", opponent: "k3" });
  await k1.call("cancelBattle", { id: a.id });
  await k1.call("createBattle", { mode: "timetrial", opponent: "k3", choreId: "c1" });
  await k3.call("createBattle", { mode: "ghost", choreId: "c1" });
  await rejects(k2.call("createBattle", { mode: "roomrush", opponent: "k3" }), /Maggie has done 2 battles today/);
});

test("battles respect quiet hours and the parent's off switches", async () => {
  const battles = (b) => ({ ...CONFIG, game: { ...CONFIG.game, battles: { ...CONFIG.game.battles, ...b } } });
  await reset(battles({ quietStart: "00:00", quietEnd: "23:59" }));
  let k1 = await kidClient("k1");
  await rejects(k1.call("createBattle", { mode: "roomrush", opponent: "k2" }), /asleep/);
  await reset(battles({ modesOff: ["roomrush"] }));
  k1 = await kidClient("k1");
  await rejects(k1.call("createBattle", { mode: "roomrush", opponent: "k2" }), /turned off Room Rush/);
  await reset(battles({ enabled: false }));
  k1 = await kidClient("k1");
  await rejects(k1.call("createBattle", { mode: "roomrush", opponent: "k2" }), /turned off/);
});

test("time trial: the result stays pending until a parent checks each run was done well", async () => {
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
  const parent = await parentClient();
  await rejects(k3.call("checkRun", { id, player: "k1", ok: true }), /Only a parent/);
  await rejects(parent.call("checkRun", { id, player: "k3", ok: true }), /isn't finished/);
  // A parent can check a run as soon as it's done: k1 rushed it.
  await parent.call("checkRun", { id, player: "k1", ok: false });
  await k3.call("finishAttempt", { id });
  let b = await battle(id);
  assert.ok(b.attempts.k1.entryId && b.attempts.k3.entryId, "each run logged a real chore");
  // Make k1 clearly faster, so the check decides it.
  await db.doc(`battles/${id}`).update({ "attempts.k1.ms": 30000, "attempts.k3.ms": 90000 });
  b = await battle(id);
  assert.equal(b.status, "confirming");
  assert.equal(b.result.qualityCheck, true);
  assert.equal(b.result.needsParent, true);
  await rejects(k3.call("confirmResult", { id }), /parent has to check/);
  await rejects(parent.call("confirmResult", { id, action: "confirm" }), /Check each run/);
  await parent.call("checkRun", { id, player: "k3", ok: true });
  b = await waitFor(async () => { const b = await battle(id); return b.live === false && b; }, { msg: "closed" });
  assert.equal(b.status, "done");
  assert.equal(b.result.winner, "k3", "the fastest run done well wins, even though k1 was faster");
  assert.deepEqual(b.xp, { k1: 0, k3: G.XP.win });
});

test("time trial: nobody passing the check is no contest", async () => {
  await reset();
  const k1 = await kidClient("k1"), k2 = await kidClient("k2"), parent = await parentClient();
  const { id } = await k1.call("createBattle", { mode: "timetrial", opponent: "k2", choreId: "c2" });
  await k2.call("respondBattle", { id, accept: true });
  for (const k of [k1, k2]) { await k.call("startAttempt", { id }); await k.call("finishAttempt", { id }); }
  await parent.call("checkRun", { id, player: "k1", ok: false });
  await parent.call("checkRun", { id, player: "k2", ok: false });
  const b = await waitFor(async () => { const b = await battle(id); return b.live === false && b; }, { msg: "closed" });
  assert.equal(b.result.noContest, true);
  assert.match(b.result.reason, /parent's check/);
  assert.deepEqual(b.xp, {});
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
  // Dad is a grown-up, so his run is final right away: no parent check.
  const b = await waitFor(async () => { const b = await battle(id); return b.live === false && b; }, { msg: "closed" });
  assert.equal(b.status, "done");
  assert.equal(b.result.record, true);
  assert.deepEqual(b.xp, { dad: G.XP.ghostRecord });
  const x = await quiet("xp/dad");
  assert.ok(x.pb.c1 >= 0, "personal best saved");
});

test("scheduled tick: challenges expire, timed-out battles finish, results auto-confirm", async () => {
  await reset();
  const k1 = await kidClient("k1"), k2 = await kidClient("k2"), k3 = await kidClient("k3");
  const parent = await parentClient();
  const p = await k1.call("createBattle", { mode: "roomrush", opponent: "k2" });
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
  assert.deepEqual(b.xp, { k3: 0, k2: G.XP.win });

  // Mid-battle, players can call it off only if everyone agrees.
  const c = await k1.call("createBattle", { mode: "roomrush", opponent: "k3" });
  await rejects(k3.call("cancelBattle", { id: c.id }), /Not now/);
  await k3.call("respondBattle", { id: c.id, accept: true });
  assert.equal((await k1.call("cancelBattle", { id: c.id })).waiting, true);
  assert.equal((await battle(c.id)).status, "active", "one player alone can't call it off");
  await rejects(k2.call("cancelBattle", { id: c.id }), /isn't yours/);
  await k3.call("cancelBattle", { id: c.id });
  assert.equal((await battle(c.id)).status, "cancelled");
  // A parent can call off a live battle on their own; a solo player can cancel theirs any time.
  const e = await k1.call("createBattle", { mode: "roomrush", opponent: "k3" });
  await k3.call("respondBattle", { id: e.id, accept: true });
  await parent.call("cancelBattle", { id: e.id });
  assert.equal((await battle(e.id)).status, "cancelled");
  const solo = await k3.call("createBattle", { mode: "roomrush", solo: true });
  await k3.call("startAttempt", { id: solo.id });
  await k3.call("cancelBattle", { id: solo.id });
  assert.equal((await battle(solo.id)).status, "cancelled");
});

test("per-mode and weekly battle limits", async () => {
  const cfg = { ...CONFIG, game: { ...CONFIG.game, battles: { ...CONFIG.game.battles, dailyCap: 10, weeklyCap: 3, modeLimits: { roomrush: { day: 1 } } } } };
  await reset(cfg);
  const k1 = await kidClient("k1"), k2 = await kidClient("k2"), k3 = await kidClient("k3");
  const done = (mode, extra = {}) => db.collection("battles").add({ mode, status: "done", live: false, players: ["k1", "k2"], challenger: "k1", day: today(), createdAt: Date.now(), ...extra });
  await done("roomrush");
  await done("roomrush", { status: "cancelled" }); // called off: doesn't count
  await rejects(k1.call("createBattle", { mode: "roomrush", opponent: "k3" }), /done 1 Room Rush battle today/);
  await rejects(k3.call("createBattle", { mode: "roomrush", opponent: "k1" }), /Teslyn has done 1 Room Rush battle today/);
  await done("blitz");
  await k1.call("createBattle", { mode: "timetrial", opponent: "k3", choreId: "c1" }); // third this week
  await rejects(k1.call("createBattle", { mode: "ghost", choreId: "c2" }), /done 3 battles this week/);
  await k2.call("createBattle", { mode: "ghost", choreId: "c2" }).catch((e) => { throw new Error("k2 has room: " + e.message); });
});

test("a custom time limit ends the battle early", async () => {
  await reset({ ...CONFIG, game: { ...CONFIG.game, battles: { ...CONFIG.game.battles, modeTimes: { blitz: 20 } } } });
  await db.doc("xp/k1").set({ total: G.levelStart(3), maxLevel: 3, unlocked: [] });
  const k1 = await kidClient("k1"), k2 = await kidClient("k2"), parent = await parentClient();
  const d = await k1.call("createBattle", { mode: "blitz", opponent: "k2" });
  assert.equal((await battle(d.id)).params.windowMin, 20, "parent's default for the mode");
  await k1.call("cancelBattle", { id: d.id });
  const { id } = await k1.call("createBattle", { mode: "blitz", opponent: "k2", windowMin: 30 });
  await k2.call("respondBattle", { id, accept: true });
  let b = await battle(id);
  assert.equal(b.params.windowMin, 30);
  assert.ok(Math.abs(b.endAt - b.startAt - Math.min(30 * 60000, b.endAt - b.startAt)) < 1000 && b.endAt - b.startAt <= 30 * 60000 + 1000, "ends within 30 minutes");
  await k1.call("completeChore", { kidId: "k1", choreId: "c1" });
  await waitFor(async () => (await battle(id)).scores?.k1?.raw === G.XP.chore, { msg: "score" });
  await parent.call("testHooks", { run: "tick", now: b.endAt + 1000 });
  b = await battle(id);
  assert.equal(b.status, "confirming");
  assert.equal(b.result.winner, "k1");
  await quiet("xp/k1");
});
