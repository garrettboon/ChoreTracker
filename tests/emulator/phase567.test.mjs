import { test, after } from "node:test";
import assert from "node:assert/strict";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import * as G from "../../public/game.js";
import {
  CONFIG, db, reset, kidClient, parentClient, closeAll, waitFor, quiet, xpOf, eventKeys, battle, today, rejects,
} from "./helpers.mjs";

after(closeAll);
const H = 3600 * 1000;
const withGame = (game) => ({ ...CONFIG, game: { ...CONFIG.game, ...game } });
const level = (id, lv) => db.doc(`xp/${id}`).set({ total: G.levelStart(lv), maxLevel: lv, unlocked: G.unlockedIds(lv, {}) }, { merge: true });
const mondayOf = (d) => { const dow = new Date(d + "T12:00:00Z").getUTCDay(); return G.addDays(d, -((dow + 6) % 7)); };

test("rewards: claim once a level is reached, parents approve, kids can't edit claims", async () => {
  await reset(withGame({ rewards: [{ id: "dinner", level: 1, name: "Pick dinner", repeat: 0 }, { id: "late", level: 5, name: "Stay up late", repeat: 5 }] }));
  const k1 = await kidClient("k1");
  await k1.call("claimReward", { rewardId: "dinner" });
  const c = (await db.doc("claims/k1_dinner_1").get()).data();
  assert.equal(c.status, "pending");
  assert.equal(c.name, "Pick dinner");
  await rejects(k1.call("claimReward", { rewardId: "dinner" }), /already claimed/);
  await rejects(k1.call("claimReward", { rewardId: "late" }), /Reach level 5/);
  await level("k1", 11);
  assert.equal((await k1.call("claimReward", { rewardId: "late" })).slot, 5);
  assert.equal((await k1.call("claimReward", { rewardId: "late" })).slot, 10);
  await rejects(k1.call("claimReward", { rewardId: "late" }), /already claimed/);
  await rejects(updateDoc(doc(k1.db, "claims", "k1_dinner_1"), { status: "approved" }), /permission|PERMISSION/i);
  const parent = await parentClient();
  await updateDoc(doc(parent.db, "claims", "k1_dinner_1"), { status: "approved" });
  // Parent push tokens: a parent can save their own; a kid can't.
  await setDoc(doc(parent.db, "parentTokens", parent.auth.currentUser.uid), { fcmToken: "t", at: 1 });
  await rejects(setDoc(doc(k1.db, "parentTokens", k1.auth.currentUser.uid), { fcmToken: "t" }), /permission|PERMISSION/i);
  await setDoc(doc(parent.db, "app", "game"), { familyGoal: { name: "Pizza", target: 500, startTotal: 0 } });
  await rejects(setDoc(doc(k1.db, "app", "game"), { familyGoal: null }), /permission|PERMISSION/i);
});

test("bounties: a kid claims, a parent awards the XP", async () => {
  await reset();
  const parent = await parentClient(), k2 = await kidClient("k2"), k3 = await kidClient("k3");
  await setDoc(doc(parent.db, "bounties", "garage"), { name: "Clean the garage", xp: 200, for: "", status: "open", createdAt: Date.now() });
  await setDoc(doc(parent.db, "bounties", "mine"), { name: "Walk the dog", xp: 50, for: "k3", status: "open", createdAt: Date.now() });
  await rejects(setDoc(doc(k2.db, "bounties", "x"), { name: "Free XP", xp: 999 }), /permission|PERMISSION/i);
  await rejects(k2.call("claimBounty", { id: "mine" }), /someone else/);
  await k2.call("claimBounty", { id: "garage" });
  await rejects(k3.call("claimBounty", { id: "garage" }), /already said/);
  await rejects(k2.call("awardBounty", { id: "garage", personId: "k2" }), /Parents only/);
  await parent.call("awardBounty", { id: "garage", personId: "k2" });
  assert.equal((await db.doc("bounties/garage").get()).data().status, "done");
  assert.ok((await eventKeys("k2")).includes("bounty:garage"));
  assert.equal((await xpOf("k2")).total, 200);
  await rejects(parent.call("awardBounty", { id: "garage", personId: "k2" }), /closed/);
});

test("territory is kids-only and counts Anyone chores", async () => {
  await reset();
  await level("k1", 6);
  const k1 = await kidClient("k1"), k2 = await kidClient("k2"), parent = await parentClient();
  await rejects(k1.call("createBattle", { mode: "territory", opponent: "dad" }), /kids only/);
  const { id } = await k1.call("createBattle", { mode: "territory", opponent: "k2" });
  await k2.call("respondBattle", { id, accept: true });
  await k2.call("completeChore", { kidId: "k2", choreId: "c1" });
  await k1.call("completeChore", { kidId: "k1", choreId: "mine" });
  await waitFor(async () => (await battle(id)).scores?.k2?.raw === 1, { msg: "territory score" });
  assert.equal((await battle(id)).scores.k1.raw, 0, "a chore that's only yours isn't a claim");
  await parent.call("testHooks", { run: "tick", now: (await battle(id)).endAt + 1000 });
  const b = await battle(id);
  assert.equal(b.status, "confirming");
  assert.equal(b.result.winner, "k2");
});

test("chore bingo: first to finish a line wins", async () => {
  await reset();
  await level("k3", 5);
  const k3 = await kidClient("k3"), k1 = await kidClient("k1");
  const { id } = await k3.call("createBattle", { mode: "bingo", opponent: "k1" });
  let b = await battle(id);
  assert.equal(b.params.card.length, 9);
  assert.deepEqual(b.params.free, { k3: [4, b.params.free.k3[1]] }, "the younger player gets free squares");
  await k1.call("respondBattle", { id, accept: true });
  // k1 fills the top row.
  for (const choreId of b.params.card.slice(0, 3)) await k1.call("completeChore", { kidId: "k1", choreId });
  b = await waitFor(async () => { const b = await battle(id); return b.status === "confirming" && b; }, { msg: "bingo" });
  assert.equal(b.result.winner, "k1");
  assert.equal(b.result.reason, "Bingo!");
});

test("judge's pick: both turn in the chore, a parent picks, even in their own battle", async () => {
  await reset();
  await level("k1", 8);
  const k1 = await kidClient("k1"), k2 = await kidClient("k2"), parent = await parentClient(), dad = await parentClient("dad@test.com");
  const { id } = await k1.call("createBattle", { mode: "judge", opponent: "k2", choreId: "c1" });
  await k2.call("respondBattle", { id, accept: true });
  await k1.call("finishAttempt", { id });
  await rejects(k1.call("finishAttempt", { id }), /already turned it in/);
  assert.equal((await battle(id)).status, "active");
  await k2.call("finishAttempt", { id });
  assert.equal((await battle(id)).status, "judging");
  await rejects(k1.call("judgeBattle", { id, winner: "k1" }), /Only a parent/);
  await parent.call("judgeBattle", { id, winner: "k2" });
  const b = await waitFor(async () => { const b = await battle(id); return !b.live && b; }, { msg: "judged" });
  assert.equal(b.result.winner, "k2");
  assert.deepEqual(b.xp, { k1: 5, k2: 15 });
  // Dad can judge a battle he's in.
  await level("dad", 8);
  const j = await dad.call("createBattle", { mode: "judge", opponent: "k3", choreId: "c2", as: "dad" });
  const k3 = await kidClient("k3");
  await k3.call("respondBattle", { id: j.id, accept: true });
  await dad.call("finishAttempt", { id: j.id, as: "dad" });
  await k3.call("finishAttempt", { id: j.id });
  await dad.call("judgeBattle", { id: j.id, winner: "dad" });
  const jb = await waitFor(async () => { const b = await battle(j.id); return !b.live && b; }, { msg: "judged own" });
  assert.equal(jb.result.winner, "dad");
});

test("streak duel: the first to miss a day loses; results need no confirmation", async () => {
  await reset();
  await level("k1", 10);
  const k1 = await kidClient("k1"), k2 = await kidClient("k2"), parent = await parentClient();
  const { id } = await k1.call("createBattle", { mode: "streakduel", opponent: "k2" });
  await k2.call("respondBattle", { id, accept: true });
  const start = (await battle(id)).params.startDate;
  assert.equal(start, today(1));
  await db.doc("prefs/k1").set({ prLog: { [start]: ["p1", "p2"] } });
  await db.doc("prefs/k2").set({ prLog: { [start]: ["p1"] } });
  await parent.call("testHooks", { run: "tick", now: Date.now() + 50 * H }); // well into the day after the duel's first day
  const b = await waitFor(async () => { const b = await battle(id); return !b.live && b; }, { msg: "duel over" });
  assert.equal(b.status, "done");
  assert.equal(b.result.winner, "k1");
  assert.deepEqual(b.xp, { k1: 30, k2: 10 });
});

test("goal showdown: best share of the weekly goal once both weeks are cashed out", async () => {
  await reset();
  await level("k1", 12);
  const k1 = await kidClient("k1"), k3 = await kidClient("k3"), parent = await parentClient();
  const { id } = await k1.call("createBattle", { mode: "showdown", opponent: "k3" });
  await k3.call("respondBattle", { id, accept: true });
  const wk = (await battle(id)).params.week;
  await parent.call("testHooks", { run: "tick" });
  assert.equal((await battle(id)).status, "active", "waits for the cash-out");
  await db.doc(`weeks/${wk}_k1`).set({ kidId: "k1", week: wk, goal: 4, closed: true, cashout: { net: 2, met: false }, entries: [], deductions: [] });
  await db.doc(`weeks/${wk}_k3`).set({ kidId: "k3", week: wk, goal: 2, closed: true, cashout: { net: 2, met: true }, entries: [], deductions: [] });
  await parent.call("testHooks", { run: "tick" });
  const b = await waitFor(async () => { const b = await battle(id); return !b.live && b; }, { msg: "showdown over" });
  assert.equal(b.result.winner, "k3");
  assert.deepEqual(b.scores, { k1: { raw: 50, adj: 50 }, k3: { raw: 100, adj: 100 } });
});

test("boss raid: teammates accept, chores do damage, a beaten boss moves the family on", async () => {
  await reset();
  await level("k1", 15);
  const k1 = await kidClient("k1"), k2 = await kidClient("k2");
  await rejects(k1.call("createBattle", { mode: "raid", team: [] }), /teammates/);
  const { id } = await k1.call("createBattle", { mode: "raid", team: ["k2"], days: 1 });
  let b = await battle(id);
  assert.equal(b.params.hp, 120);
  assert.equal(b.params.bossName, "Sock Goblin");
  await k2.call("respondBattle", { id, accept: true });
  assert.equal((await battle(id)).status, "active");
  for (let i = 0; i < 6; i++) await k1.call("completeChore", { kidId: "k1", choreId: "big" });
  b = await waitFor(async () => { const b = await battle(id); return !b.live && b; }, { msg: "boss beaten" });
  assert.equal(b.result.winnerSide, "a");
  assert.deepEqual(b.xp, { k1: 25, k2: 0 });
  assert.equal((await db.doc("xp/_family").get()).data().bossesBeaten, 1);
  const next = await k1.call("createBattle", { mode: "raid", team: ["k2"], days: 2 });
  const nb = await battle(next.id);
  assert.equal(nb.params.bossName, "Dish Hydra");
  assert.equal(nb.params.hp, G.raidHp(2, 2, 1));
});

test("baby boss raid: level 1, solo allowed and starts at once, tiny boss, small XP, own roster", async () => {
  await reset();
  const k3 = await kidClient("k3");
  const { id } = await k3.call("createBattle", { mode: "babyraid", team: [] });
  let b = await battle(id);
  assert.equal(b.status, "active", "a solo baby raid needs nobody's acceptance");
  assert.equal(b.params.hp, 15);
  assert.equal(b.params.bossName, "Dust Bunny");
  await k3.call("completeChore", { kidId: "k3", choreId: "big" });
  b = await waitFor(async () => { const b = await battle(id); return !b.live && b; }, { msg: "baby boss beaten" });
  assert.equal(b.result.winnerSide, "a");
  assert.deepEqual(b.xp, { k3: 10 });
  const fam = (await db.doc("xp/_family").get()).data();
  assert.equal(fam.babyBossesBeaten, 1);
  assert.equal(fam.bossesBeaten || 0, 0, "baby bosses don't count toward the real roster");
  const k1 = await kidClient("k1");
  const team = await k1.call("createBattle", { mode: "babyraid", team: ["k2"] });
  const tb = await battle(team.id);
  assert.equal(tb.status, "pending", "with a teammate it waits for them to accept");
  assert.equal(tb.params.hp, 30);
  assert.equal(tb.params.bossName, "Crumb Critter");
});

test("kids vs grown-ups: every invitee accepts, kids get a team handicap", async () => {
  await reset();
  await level("k1", 15);
  const k1 = await kidClient("k1"), k3 = await kidClient("k3"), dad = await parentClient("dad@test.com"), parent = await parentClient();
  await rejects(k1.call("createBattle", { mode: "grownups", team: ["k3"] }), /grown-up/);
  const { id } = await k1.call("createBattle", { mode: "grownups", team: ["k3"], opponents: ["dad"], windowMin: 30 });
  let b = await battle(id);
  assert.deepEqual(b.teams, { a: ["k1", "k3"], b: ["dad"] });
  assert.ok(b.teamHandicap.a > 1);
  await dad.call("respondBattle", { id, accept: true, as: "dad" });
  assert.equal((await battle(id)).status, "pending", "waits for every invitee");
  await k3.call("respondBattle", { id, accept: true });
  assert.equal((await battle(id)).status, "active");
  await k3.call("completeChore", { kidId: "k3", choreId: "c1" });
  await waitFor(async () => (await battle(id)).teamScores?.a?.raw === 10, { msg: "team score" });
  await parent.call("testHooks", { run: "tick", now: (await battle(id)).endAt + 1000 });
  b = await battle(id);
  assert.equal(b.status, "confirming");
  assert.equal(b.result.winnerSide, "a");
  await rejects(k3.call("confirmResult", { id }), /other player or a parent/);
  await dad.call("confirmResult", { id, as: "dad" });
  b = await waitFor(async () => { const b = await battle(id); return !b.live && b; }, { msg: "closed" });
  assert.deepEqual(b.xp, { k1: 0, k3: 15, dad: 0 });
});

test("wildcard picks a random mode with a twist", async () => {
  await reset();
  await level("k1", 20);
  const k1 = await kidClient("k1");
  const r = await k1.call("createBattle", { mode: "wildcard", opponent: "k2" });
  assert.ok(G.WILDCARD_MODES.includes(r.mode));
  const b = await battle(r.id);
  assert.equal(b.wildcard, true);
  if (b.mode !== "bingo") assert.ok(b.twist && b.twist.choreId);
});

test("weekly quests pay once when finished", async () => {
  await reset({ ...CONFIG, game: { ...CONFIG.game, choreOfDay: { enabled: true, pin: null }, quests: { enabled: true } } });
  const mon = mondayOf(today());
  const at7 = (d) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd, 13); }; // 7 AM in Denver (MDT)
  const entries = [];
  let n = 0;
  for (let i = 0; i < 5; i++) {
    const date = G.addDays(mon, i);
    for (const choreId of ["c1", "c2", "big"]) entries.push({ id: `e${n++}`, t: at7(date) + n, type: "chore", choreId, name: choreId, amount: 1, date, status: "ok" });
  }
  const log = {};
  for (let i = 0; i < 5; i++) log[G.addDays(mon, i)] = ["p1", "p2"];
  await db.doc("prefs/k3").set({ prLog: log });
  await db.doc(`weeks/${mon}_k3`).set({ kidId: "k3", week: mon, goal: 2, entries, deductions: [] });
  await quiet("xp/k3", 2500);
  const parent = await parentClient();
  await parent.call("testHooks", { run: "quests", person: "k3" });
  const keys = await eventKeys("k3");
  for (const q of G.weeklyQuests(mon, "k3")) {
    if (q.id === "battle") continue;
    assert.ok(keys.includes(`quest:${mon}:${q.id}`), `quest ${q.id} paid`);
  }
  const before = (await xpOf("k3")).total;
  await parent.call("testHooks", { run: "quests", person: "k3" });
  assert.equal((await xpOf("k3")).total, before, "paid only once");
});
