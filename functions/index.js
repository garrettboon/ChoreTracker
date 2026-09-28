"use strict";
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineString } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const crypto = require("crypto");
// Shared game rules. Identical copy of public/game.js (run `npm run sync` after editing that file).
const G = require("./game.mjs");

initializeApp();
const db = getFirestore();

// Comma-separated Google account emails allowed to act as parents (set in functions/.env).
const PARENT_EMAILS = defineString("PARENT_EMAILS");
const FAMILY_TZ = "America/Denver";

const DEFAULT_CONFIG = {
  timezone: FAMILY_TZ,
  split: { spend: 50, save: 25, invest: 15, give: 10 },
  interest: { low: 10, threshold: 100, high: 5 },
  kids: [
    { id: "dad", name: "Dad", age: 0, adult: true, rate: 0.5, remind: [] },
    { id: "k1", name: "Teslyn", age: 12, rate: 0.5, remind: ["15:30", "19:30"] },
    { id: "k2", name: "Warren", age: 10, rate: 0.25, remind: ["15:30", "19:30"] },
    { id: "k3", name: "Maggie", age: 8, rate: 0.25, remind: ["15:30", "19:00"] },
  ],
  chores: [
    { id: "sweep", kind: "family", name: "Sweep a room", mult: 1, limit: 3, assign: "pool" },
    { id: "drainer", kind: "family", name: "Empty dish drainer", mult: 1, limit: 1, assign: "pool" },
    { id: "dishes", kind: "family", name: "Wash 20 dishes", mult: 1, limit: 3, assign: "pool" },
    { id: "tidy20", kind: "family", name: "Clean up 20 things in a room", mult: 1, limit: 3, assign: "pool" },
    { id: "yard", kind: "family", name: "Clean up toys in yard", mult: 1, limit: 1, assign: "pool" },
    { id: "read", kind: "family", name: "Read for 20 minutes", mult: 1, limit: 1, assign: "pool" },
    { id: "bathroom", kind: "family", name: "Clean bathroom", mult: 2, limit: 1, assign: "pool" },
    { id: "laundry", kind: "family", name: "Do laundry", mult: 2, limit: 1, assign: "pool" },
    { id: "morning", kind: "pr", name: "Morning routine", note: "Make bed, brush teeth, clean up breakfast" },
    { id: "practice", kind: "pr", name: "Practice 20 minutes", note: "Sport, music, or coding" },
    { id: "teeth", kind: "pr", name: "Brush teeth at night", note: "" },
  ],
};

function parentList() {
  return PARENT_EMAILS.value().split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function isParentAuth(auth) {
  return !!(auth && auth.token && auth.token.email && auth.token.email_verified &&
    parentList().includes(String(auth.token.email).toLowerCase()));
}

// Local date/time in the family's time zone.
function localParts(tz, d = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hm: `${p.hour}:${p.minute}`,
    dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
}
function addDays(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const mondayOf = (date, dow) => addDays(date, -((dow + 6) % 7));
const toMin = (hm) => { const [h, m] = String(hm).split(":").map(Number); return h * 60 + m; };

// Called by the app after a parent signs in with Google. Keeps the parent list in sync
// with functions/.env and creates the starter setup the first time.
exports.setupFamily = onCall(async (req) => {
  if (!isParentAuth(req.auth)) {
    throw new HttpsError("permission-denied", "This Google account isn't on this family's parent list.");
  }
  await db.doc("app/family").set({ parentEmails: parentList() });
  const cfgRef = db.doc("app/config");
  if (!(await cfgRef.get()).exists) await cfgRef.set(DEFAULT_CONFIG);
  return { ok: true };
});

// A tablet signs in anonymously, then trades a parent-made 6-digit code for a role.
exports.pairDevice = onCall(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign-in didn't finish. Reload and try again.");
  const code = String((req.data && req.data.code) || "").trim();
  if (!/^\d{6}$/.test(code)) throw new HttpsError("invalid-argument", "Codes are 6 digits.");
  const name = String((req.data && req.data.name) || "").trim().slice(0, 40);
  const ref = db.doc(`pairCodes/${code}`);
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "That code didn't work. Ask a parent for a new one.");
    const c = snap.data();
    if (c.expiresAt.toMillis() < Date.now()) {
      t.delete(ref);
      throw new HttpsError("deadline-exceeded", "That code expired. Ask a parent for a new one.");
    }
    t.set(db.doc(`devices/${req.auth.uid}`), {
      role: c.role,
      kidId: c.kidId || null,
      name: name || (c.role === "display" ? "Leaderboard" : "Tablet"),
      pairedAt: FieldValue.serverTimestamp(),
      pairedBy: c.createdBy || null,
    });
    t.delete(ref);
    return { role: c.role, kidId: c.kidId || null };
  });
});

// Logs one chore inside a transaction. Shared by completeChore and Time Trial finishes.
function logChore(kidId, choreId, by) {
  return db.runTransaction(async (t) => {
    const cfg = (await t.get(db.doc("app/config"))).data();
    const kid = cfg && cfg.kids.find((k) => k.id === kidId);
    const ch = cfg && cfg.chores.find((c) => c.id === choreId && c.kind === "family");
    if (!kid || !ch) throw new HttpsError("invalid-argument", "Unknown chore.");
    if (ch.assign !== "pool" && ch.assign !== kidId) throw new HttpsError("permission-denied", "That chore belongs to someone else.");

    const L = localParts(cfg.timezone || FAMILY_TZ);
    const mon = mondayOf(L.date, L.dow);
    const counted = ch.assign === "pool" && !kid.adult ? cfg.kids.filter((k) => !k.adult).map((k) => k.id) : [kidId];
    const refs = [];
    for (const id of counted) for (const wk of [mon, addDays(mon, 7)]) refs.push(db.doc(`weeks/${wk}_${id}`));
    const snaps = await t.getAll(...refs);
    let n = 0;
    for (const s of snaps) {
      if (!s.exists) continue;
      for (const e of s.data().entries || []) {
        if (e.choreId === choreId && e.date === L.date && e.status !== "reversed") n++;
      }
    }
    if (n >= (ch.limit || 1)) throw new HttpsError("failed-precondition", "That one's done for today.");

    const thisWeek = snaps.find((s) => s.id === `${mon}_${kidId}`);
    const wk = thisWeek && thisWeek.exists && thisWeek.data().closed ? addDays(mon, 7) : mon;
    const amount = Math.round((kid.rate || 0) * (ch.mult || 1) * 100) / 100;
    const entry = {
      id: crypto.randomBytes(5).toString("hex"), t: Date.now(), type: "chore",
      choreId, name: ch.name, amount, date: L.date, status: "ok",
    };
    if (by) entry.by = by;
    t.set(db.doc(`weeks/${wk}_${kidId}`), { kidId, week: wk, entries: FieldValue.arrayUnion(entry) }, { merge: true });
    return { amount, week: wk, entryId: entry.id };
  });
}

// Chore completions go through the server so the amount and daily limits can't be faked.
exports.completeChore = onCall(async (req) => {
  const auth = req.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Not signed in.");
  const kidId = String((req.data && req.data.kidId) || "");
  const choreId = String((req.data && req.data.choreId) || "");
  let by = null;
  if (isParentAuth(auth)) {
    by = auth.token.name || auth.token.email;
  } else {
    const dev = await db.doc(`devices/${auth.uid}`).get();
    if (!dev.exists || dev.data().role !== "kid" || dev.data().kidId !== kidId) {
      throw new HttpsError("permission-denied", "This device can't log chores for that person.");
    }
  }
  const r = await logChore(kidId, choreId, by);
  return { amount: r.amount, week: r.week };
});

// Sends one notification to device docs that have push tokens, and drops dead tokens.
async function sendPush(targets, notification) {
  if (!targets.length) return;
  const res = await getMessaging().sendEachForMulticast({ tokens: targets.map((d) => d.data().fcmToken), notification });
  await Promise.all(res.responses.map((r, i) => {
    const code = r.error && r.error.code;
    if (!r.success && (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token")) {
      return targets[i].ref.update({ fcmToken: FieldValue.delete() });
    }
    return null;
  }));
}

// Every 15 minutes: at each person's reminder times, push a list of what's still unchecked.
exports.sendReminders = onSchedule({ schedule: "every 15 minutes", timeZone: FAMILY_TZ }, async () => {
  const cfgSnap = await db.doc("app/config").get();
  if (!cfgSnap.exists) return;
  const cfg = cfgSnap.data();
  const L = localParts(cfg.timezone || FAMILY_TZ);
  const nowMin = toMin(L.hm);
  const mon = mondayOf(L.date, L.dow);
  const devices = (await db.collection("devices").where("role", "==", "kid").get()).docs;

  for (const kid of cfg.kids) {
    const due = (kid.remind || []).some((t) => { const m = toMin(t); return m <= nowMin && m > nowMin - 15; });
    if (!due) continue;
    const targets = devices.filter((d) => d.data().kidId === kid.id && d.data().fcmToken);
    if (!targets.length) continue;

    const prefs = (await db.doc(`prefs/${kid.id}`).get()).data() || {};
    const done = (prefs.prLog || {})[L.date] || [];
    const weeks = await db.getAll(db.doc(`weeks/${mon}_${kid.id}`), db.doc(`weeks/${addDays(mon, 7)}_${kid.id}`));
    const entries = weeks.flatMap((s) => (s.exists ? s.data().entries || [] : []));
    const todo = [
      ...cfg.chores.filter((c) => c.kind === "pr" && !done.includes(c.id)).map((c) => c.name),
      ...cfg.chores.filter((c) => c.kind === "family" && c.assign === kid.id &&
        !entries.some((e) => e.choreId === c.id && e.date === L.date && e.status !== "reversed")).map((c) => c.name),
    ];
    if (!todo.length) continue;

    await sendPush(targets, { title: `${kid.name}, still to do today`, body: todo.join(", ") });
  }
});

/* =====================================================================
   Game layer: XP, levels, streak freezes, and chore battles.
   Rules and numbers live in game.mjs; this file applies them to Firestore.
   ===================================================================== */

async function getConfig() {
  const s = await db.doc("app/config").get();
  return s.exists ? s.data() : null;
}
const tzOf = (cfg) => (cfg && cfg.timezone) || FAMILY_TZ;
const prIdsOf = (cfg) => cfg.chores.filter((c) => c.kind === "pr").map((c) => c.id);
// Milliseconds until the next local midnight.
function endOfLocalDay(cfg, now = Date.now()) {
  const L = localParts(tzOf(cfg), new Date(now));
  return now + ((24 * 60 - toMin(L.hm)) * 60 - new Date(now).getUTCSeconds()) * 1000;
}
const personName = (cfg, id) => ((cfg.kids.find((k) => k.id === id) || {}).name || "Someone");

// Who the caller is acting as. Kid tablets act as their paired person. A signed-in parent
// acts as an adult profile passed in `as`, which must be theirs if it has an email set.
async function actor(req, cfg) {
  const auth = req.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Not signed in.");
  if (isParentAuth(auth)) {
    const as = String((req.data && req.data.as) || "");
    const p = cfg.kids.find((k) => k.id === as);
    if (!p || !p.adult) throw new HttpsError("permission-denied", "Open your own profile tab first.");
    if (p.email && p.email.toLowerCase() !== String(auth.token.email).toLowerCase()) {
      throw new HttpsError("permission-denied", `That's ${p.name}'s profile.`);
    }
    return { id: p.id, parent: true, by: auth.token.name || auth.token.email };
  }
  const dev = await db.doc(`devices/${auth.uid}`).get();
  const d = dev.exists ? dev.data() : null;
  if (!d || d.role !== "kid" || !cfg.kids.some((k) => k.id === d.kidId)) {
    throw new HttpsError("permission-denied", "This device isn't paired to a person.");
  }
  return { id: d.kidId, parent: false, by: null };
}

async function pushTo(ids, title, body) {
  try {
    const devices = (await db.collection("devices").where("role", "==", "kid").get()).docs;
    await sendPush(devices.filter((d) => ids.includes(d.data().kidId) && d.data().fcmToken), { title, body });
  } catch (e) {
    console.warn("push failed", e);
  }
}

/* ---------- XP ledger ---------- */

// Adds and removes XP events for one person. Every event has a deterministic key, so
// repeating the same award is a no-op. adds: [{ key, amount, reason, count?, freeze? }].
// `mutate(x)` can change the xp doc in the same transaction; return false for "no change".
async function applyXp(personId, adds = [], removes = [], mutate = null) {
  const ops = [...adds.filter((a) => a.amount > 0).map((a) => ({ add: a })), ...removes.map((k) => ({ remove: k }))];
  const chunks = [];
  for (let i = 0; i < ops.length; i += 150) chunks.push(ops.slice(i, i + 150));
  if (!chunks.length) { if (!mutate) return; chunks.push([]); }
  const ref = db.doc(`xp/${personId}`);
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    await db.runTransaction(async (t) => {
      const refs = chunk.map((o) => ref.collection("events").doc(o.add ? o.add.key : o.remove));
      const [snap, ...evs] = await t.getAll(ref, ...refs);
      const x = Object.assign({ total: 0, maxLevel: 1, counts: {}, freezes: 0, frozenDates: [], pb: {}, bestStreak: 0 },
        snap.exists ? snap.data() : {});
      x.counts = { ...x.counts };
      const before = G.unlockedIds(x.maxLevel, x);
      let changed = !snap.exists;
      chunk.forEach((o, i) => {
        if (o.add && !evs[i].exists) {
          const count = o.add.count || [o.add.key.split(":")[0]];
          t.set(refs[i], { key: o.add.key, amount: o.add.amount, reason: o.add.reason || "", t: Date.now(), count });
          x.total += o.add.amount;
          count.forEach((c) => { x.counts[c] = (x.counts[c] || 0) + 1; });
          if (o.add.freeze) x.freezes = Math.min(G.FREEZE_CAP, (x.freezes || 0) + 1);
          changed = true;
        } else if (o.remove && evs[i].exists) {
          const e = evs[i].data();
          t.delete(refs[i]);
          x.total = Math.max(0, x.total - (e.amount || 0));
          (e.count || []).forEach((c) => { x.counts[c] = Math.max(0, (x.counts[c] || 0) - 1); });
          changed = true;
        }
      });
      if (mutate && ci === chunks.length - 1 && mutate(x) !== false) changed = true;
      if (!changed) return;
      x.level = G.levelFor(x.total);
      if (x.level > x.maxLevel) {
        const gained = G.freezeLevels(x.maxLevel, x.level);
        x.freezes = Math.min(G.FREEZE_CAP, (x.freezes || 0) + gained);
        x.levelUp = {
          level: x.level, from: x.maxLevel, at: Date.now(), freezes: gained,
          unlocks: G.unlockedIds(x.level, x).filter((u) => !before.includes(u)),
        };
        x.maxLevel = x.level;
      }
      x.unlocked = G.unlockedIds(x.maxLevel, x);
      x.updatedAt = Date.now();
      t.set(ref, x);
    });
  }
}

// Streak multiplier for chore XP awarded right now.
async function choreBoost(cfg, personId) {
  const [p, x] = await db.getAll(db.doc(`prefs/${personId}`), db.doc(`xp/${personId}`));
  const prefs = p.exists ? p.data() : {};
  const frozen = (x.exists && x.data().frozenDates) || [];
  const today = localParts(tzOf(cfg)).date;
  return G.streakBoost(cfg, G.streak(prefs.prLog, prIdsOf(cfg), today, frozen));
}

// XP changes implied by a week doc changing from `before` to `after`.
// `historical` (backfill) scores every entry at base value and never removes.
async function weekXp(cfg, personId, before, after, historical) {
  const adds = [], removes = [];
  if (!after) return { adds, removes };
  const prevE = new Map(((before && before.entries) || []).map((e) => [e.id, e]));
  let boost = null;
  for (const e of after.entries || []) {
    const prev = prevE.get(e.id);
    if (e.status === "reversed") {
      if (!historical && (!prev || prev.status !== "reversed")) removes.push("chore:" + e.id);
      continue;
    }
    if (!historical && prev && prev.status !== "reversed") continue;
    const ch = cfg.chores.find((c) => c.id === e.choreId) || { mult: 1 };
    let amount;
    if (historical) amount = G.baseChoreXp(ch);
    else {
      if (boost == null) boost = await choreBoost(cfg, personId);
      amount = G.choreXp(ch, { cotd: G.choreOfDay(cfg.chores, e.date, cfg) === e.choreId, boost });
    }
    adds.push({ key: "chore:" + e.id, amount, reason: e.name || ch.name || "Chore", count: ["chore"] });
  }
  const prevD = new Map(((before && before.deductions) || []).map((d) => [d.id, d]));
  for (const d of after.deductions || []) {
    const prev = prevD.get(d.id);
    if (d.status === "redeemed" && (historical || !prev || prev.status !== "redeemed")) {
      adds.push({ key: "redeem:" + d.id, amount: G.XP.redeem, reason: "Earned back: " + (d.reason || "deduction"), count: ["redeem"] });
    }
  }
  if (after.closed && after.cashout && after.cashout.met) {
    adds.push({ key: "goal:" + after.week, amount: G.XP.goal, reason: "Weekly goal reached", count: ["goal"] });
  }
  return { adds, removes };
}

// Awards XP for every badge the person has earned (each badge pays once).
async function syncBadges(cfg, personId) {
  const L = localParts(tzOf(cfg));
  const mon = mondayOf(L.date, L.dow);
  const [b, p, x, ...ws] = await db.getAll(db.doc(`bank/${personId}`), db.doc(`prefs/${personId}`), db.doc(`xp/${personId}`),
    ...[addDays(mon, -7), mon, addDays(mon, 7)].map((wk) => db.doc(`weeks/${wk}_${personId}`)));
  const bank = b.exists ? b.data() : {}, prefs = p.exists ? p.data() : {}, xd = x.exists ? x.data() : {};
  const live = ws.filter((s) => s.exists && !s.data().closed)
    .reduce((n, s) => n + (s.data().entries || []).filter((e) => e.status !== "reversed").length, 0);
  const st = bank.stats || {}, archived = bank.archived || [];
  const saved = Object.values(bank.goalBal || {}).reduce((s, v) => s + (Number(v) || 0), 0) +
    archived.reduce((s, a) => s + (a.bought || 0), 0);
  const counts = xd.counts || {};
  const list = G.badgeList({
    chores: (st.chores || 0) + live, goalHits: st.goalHits || 0, redemptions: st.redemptions || 0,
    bestStreak: G.bestStreak(prefs.prLog, prIdsOf(cfg), xd.frozenDates || []),
    saved, invest: bank.invest || 0, give: bank.give || 0, bought: archived.length,
    wins: counts.win || 0, giant: counts.giant || 0,
  });
  await applyXp(personId, list.filter((x) => x[3]).map((x) => ({
    key: "badge:" + x[0], amount: G.XP.badge, reason: "Badge: " + x[2], count: ["badge"],
  })));
}

// Checklist XP and streak milestones. `sinceDate` limits milestones to runs reaching them
// on or after that date (triggers only pay for today and yesterday).
function checklistXp(cfg, prLog, frozen, dates, sinceDate) {
  const prIds = prIdsOf(cfg);
  const adds = [];
  for (const d of dates) {
    if (G.dayComplete(prLog, prIds, d, [])) adds.push({ key: "pr:" + d, amount: G.XP.checklist, reason: "Daily checklist done", count: ["pr"] });
  }
  for (const m of G.streakMilestones(prLog, prIds, frozen)) {
    if (!sinceDate || m.date >= sinceDate) {
      adds.push({ key: m.key, amount: m.amount, reason: `${m.days}-day streak`, count: ["streak"], freeze: m.days === 30 });
    }
  }
  return adds;
}
// Keeps bestStreak current and refunds a freeze if the frozen day was completed after all.
function streakMutator(cfg, prLog) {
  const prIds = prIdsOf(cfg);
  return (x) => {
    let changed = false;
    const best = G.bestStreak(prLog, prIds, x.frozenDates || []);
    if (best > (x.bestStreak || 0)) { x.bestStreak = best; changed = true; }
    const refund = (x.frozenDates || []).filter((d) => G.dayComplete(prLog, prIds, d, []));
    if (refund.length) {
      x.frozenDates = x.frozenDates.filter((d) => !refund.includes(d));
      x.freezes = Math.min(G.FREEZE_CAP, (x.freezes || 0) + refund.length);
      changed = true;
    }
    return changed;
  };
}

exports.onWeekWrite = onDocumentWritten("weeks/{id}", async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const w = after || before;
  const cfg = await getConfig();
  if (!w || !w.kidId || !cfg || !cfg.kids.some((k) => k.id === w.kidId)) return;
  const { adds, removes } = await weekXp(cfg, w.kidId, before, after, false);
  await applyXp(w.kidId, adds, removes);
  await syncBadges(cfg, w.kidId);
  await updateBattlesFor(cfg, w.kidId);
});

exports.onPrefsWrite = onDocumentWritten("prefs/{id}", async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.exists ? event.data.after.data() : null;
  const personId = event.params.id;
  if (!after || JSON.stringify(before.prLog || {}) === JSON.stringify(after.prLog || {})) return;
  const cfg = await getConfig();
  if (!cfg || !cfg.kids.some((k) => k.id === personId)) return;
  const today = localParts(tzOf(cfg)).date, yesterday = addDays(today, -1);
  const xs = await db.doc(`xp/${personId}`).get();
  const frozen = (xs.exists && xs.data().frozenDates) || [];
  await applyXp(personId, checklistXp(cfg, after.prLog, frozen, [today, yesterday], yesterday), [], streakMutator(cfg, after.prLog));
  await syncBadges(cfg, personId);
});

exports.onBankWrite = onDocumentWritten("bank/{id}", async (event) => {
  const after = event.data.after.exists ? event.data.after.data() : null;
  const personId = event.params.id;
  const cfg = await getConfig();
  if (!after || !cfg || !cfg.kids.some((k) => k.id === personId)) return;
  await applyXp(personId, (after.archived || []).map((a, i) => ({
    key: "buy:" + i, amount: G.XP.savingsGoal, reason: "Bought: " + (a.name || "savings goal"), count: ["sgoal"],
  })));
  await syncBadges(cfg, personId);
});

// Parent-run, repeatable: gives everyone XP for their history so far.
async function backfillPerson(cfg, personId) {
  const weeks = await db.collection("weeks").where("kidId", "==", personId).get();
  const adds = [];
  for (const d of weeks.docs) adds.push(...(await weekXp(cfg, personId, null, d.data(), true)).adds);
  const [p, b, x] = await db.getAll(db.doc(`prefs/${personId}`), db.doc(`bank/${personId}`), db.doc(`xp/${personId}`));
  const prLog = (p.exists && p.data().prLog) || {};
  const frozen = (x.exists && x.data().frozenDates) || [];
  adds.push(...checklistXp(cfg, prLog, frozen, Object.keys(prLog), null));
  ((b.exists && b.data().archived) || []).forEach((a, i) => adds.push({
    key: "buy:" + i, amount: G.XP.savingsGoal, reason: "Bought: " + (a.name || "savings goal"), count: ["sgoal"],
  }));
  await applyXp(personId, adds, [], streakMutator(cfg, prLog));
  await syncBadges(cfg, personId);
  const after = await db.doc(`xp/${personId}`).get();
  return after.exists ? { total: after.data().total, level: after.data().maxLevel } : { total: 0, level: 1 };
}
exports.backfillXp = onCall({ timeoutSeconds: 300 }, async (req) => {
  if (!isParentAuth(req.auth)) throw new HttpsError("permission-denied", "Parents only.");
  const cfg = await getConfig();
  if (!cfg) throw new HttpsError("failed-precondition", "No family setup yet.");
  const out = {};
  for (const k of cfg.kids) out[k.id] = await backfillPerson(cfg, k.id);
  return out;
});

// Just after midnight: spend a streak freeze for anyone who missed yesterday's checklist.
async function runFreezes() {
  const cfg = await getConfig();
  if (!cfg) return;
  const prIds = prIdsOf(cfg);
  if (!prIds.length) return;
  const y = addDays(localParts(tzOf(cfg)).date, -1);
  for (const k of cfg.kids) {
    const [p, x] = await db.getAll(db.doc(`prefs/${k.id}`), db.doc(`xp/${k.id}`));
    if (!x.exists || !(x.data().freezes > 0)) continue;
    const prLog = (p.exists && p.data().prLog) || {};
    const frozen = x.data().frozenDates || [];
    if (G.dayComplete(prLog, prIds, y, frozen)) continue;
    if (G.streakEnding(prLog, prIds, addDays(y, -1), frozen) < 1) continue;
    await applyXp(k.id, [], [], (xd) => {
      if (!(xd.freezes > 0) || (xd.frozenDates || []).includes(y)) return false;
      xd.freezes -= 1;
      xd.frozenDates = [...(xd.frozenDates || []), y].slice(-60);
      xd.notice = { type: "freeze", date: y, at: Date.now() };
      return true;
    });
    await pushTo([k.id], "🧊 Streak saved!", `${k.name}, a streak freeze covered yesterday. Keep it going today!`);
  }
}
exports.useStreakFreezes = onSchedule({ schedule: "10 0 * * *", timeZone: FAMILY_TZ }, runFreezes);

/* ---------- battles ---------- */

const MS_PENDING = 2 * 3600 * 1000;       // unanswered challenges expire
const MS_AUTOCONFIRM = 12 * 3600 * 1000;  // unconfirmed results confirm themselves
const MS_PARENT_WAIT = 48 * 3600 * 1000;  // flagged results nobody checked become no contest
const MS_COOLDOWN = 3600 * 1000;          // after a decline

// Chore entries per player from the week docs around the battle day.
async function battleEntries(cfg, b) {
  const [y, m, d] = b.day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const mon = mondayOf(b.day, dow);
  const refs = [];
  for (const p of b.players) for (const wk of [mon, addDays(mon, 7)]) refs.push(db.doc(`weeks/${wk}_${p}`));
  const snaps = await db.getAll(...refs);
  const out = {};
  b.players.forEach((p) => { out[p] = []; });
  for (const s of snaps) if (s.exists) out[s.data().kidId] = (out[s.data().kidId] || []).concat(s.data().entries || []);
  return out;
}

// How many of today's limit is left on a chore, as seen by each player.
async function choreRoom(cfg, ch, playerIds) {
  const L = localParts(tzOf(cfg));
  const mon = mondayOf(L.date, L.dow);
  const kidsIds = cfg.kids.filter((k) => !k.adult).map((k) => k.id);
  const ids = [...new Set([...kidsIds, ...playerIds])];
  const snaps = await db.getAll(...ids.flatMap((id) => [mon, addDays(mon, 7)].map((wk) => db.doc(`weeks/${wk}_${id}`))));
  const doneBy = {};
  for (const s of snaps) {
    if (!s.exists) continue;
    const n = (s.data().entries || []).filter((e) => e.choreId === ch.id && e.date === L.date && e.status !== "reversed").length;
    doneBy[s.data().kidId] = (doneBy[s.data().kidId] || 0) + n;
  }
  const lim = ch.limit || 1;
  const shared = kidsIds.reduce((s, id) => s + (doneBy[id] || 0), 0);
  const room = {};
  for (const id of playerIds) {
    const p = cfg.kids.find((k) => k.id === id);
    room[id] = ch.assign === "pool" && !p.adult ? lim - shared : lim - (doneBy[id] || 0);
  }
  return room;
}

exports.createBattle = onCall(async (req) => {
  const cfg = await getConfig();
  if (!cfg) throw new HttpsError("failed-precondition", "No family setup yet.");
  const me = await actor(req, cfg);
  const data = req.data || {};
  const bc = G.gameCfg(cfg).battles;
  if (!bc.enabled) throw new HttpsError("failed-precondition", "Battles are turned off right now.");
  const mode = G.modeById(String(data.mode || ""));
  if (!mode || mode.soon) throw new HttpsError("invalid-argument", "That battle mode isn't ready yet.");
  if ((bc.modesOff || []).includes(mode.id)) throw new HttpsError("failed-precondition", `A parent turned off ${mode.name}.`);
  const xs = await db.doc(`xp/${me.id}`).get();
  const xd = xs.exists ? xs.data() : {};
  if ((xd.maxLevel || 1) < mode.level) throw new HttpsError("failed-precondition", `Reach level ${mode.level} to unlock ${mode.name}.`);
  const L = localParts(tzOf(cfg));
  if (G.inQuietHours(L.hm, cfg)) throw new HttpsError("failed-precondition", "Battles are asleep right now. Try again in the morning.");
  const meP = cfg.kids.find((k) => k.id === me.id);
  let opp = null;
  if (!mode.solo) {
    opp = cfg.kids.find((k) => k.id === String(data.opponent || ""));
    if (!opp || opp.id === me.id) throw new HttpsError("invalid-argument", "Pick someone to challenge.");
  }
  const players = opp ? [me.id, opp.id] : [me.id];

  const params = {};
  if (mode.id === "race") params.n = Math.min(6, Math.max(2, Math.round(Number(data.n) || 3)));
  if (mode.id === "blitz") params.windowMin = [30, 60, 0].includes(Number(data.windowMin)) ? Number(data.windowMin) : 60;
  if (G.TIMED.includes(mode.id)) {
    const ch = cfg.chores.find((c) => c.id === String(data.choreId || "") && c.kind === "family");
    if (!ch) throw new HttpsError("invalid-argument", "Pick a chore.");
    if (mode.id === "timetrial" && ch.assign !== "pool") throw new HttpsError("invalid-argument", "Time Trials need an Anyone chore.");
    if (mode.id === "ghost" && ch.assign !== "pool" && ch.assign !== me.id) throw new HttpsError("invalid-argument", "That chore belongs to someone else.");
    const room = await choreRoom(cfg, ch, players);
    const sharedKids = players.filter((id) => ch.assign === "pool" && !cfg.kids.find((k) => k.id === id).adult).length;
    const ok = players.every((id) => room[id] >= (cfg.kids.find((k) => k.id === id).adult ? 1 : Math.max(1, sharedKids)));
    if (!ok) throw new HttpsError("failed-precondition", `There isn't enough "${ch.name}" left today for this battle.`);
    params.choreId = ch.id;
    params.choreName = ch.name;
  }

  const [liveSnap, todaySnap] = await Promise.all([
    db.collection("battles").where("live", "==", true).get(),
    db.collection("battles").where("day", "==", L.date).get(),
  ]);
  const live = liveSnap.docs.map((d) => d.data());
  if (opp && live.some((b) => b.players.includes(me.id) && b.players.includes(opp.id))) {
    throw new HttpsError("failed-precondition", `You and ${opp.name} already have a battle going.`);
  }
  if (mode.solo && live.some((b) => b.mode === "ghost" && b.players[0] === me.id)) {
    throw new HttpsError("failed-precondition", "Finish your ghost race first.");
  }
  const today = todaySnap.docs.map((d) => d.data()).filter((b) => !["declined", "expired", "cancelled"].includes(b.status));
  for (const p of players) {
    if (today.filter((b) => b.players.includes(p)).length >= bc.dailyCap) {
      throw new HttpsError("failed-precondition", p === me.id ? `You've done ${bc.dailyCap} battles today. That's the limit.`
        : `${opp.name} has done ${bc.dailyCap} battles today. That's the limit.`);
    }
  }
  if (opp && todaySnap.docs.some((d) => {
    const b = d.data();
    return b.status === "declined" && b.players.includes(me.id) && b.players.includes(opp.id) && b.respondedAt > Date.now() - MS_COOLDOWN;
  })) throw new HttpsError("failed-precondition", `${opp.name} said not now. Try again in an hour.`);

  const now = Date.now();
  const b = {
    mode: mode.id, status: mode.solo ? "active" : "pending", live: true, players, challenger: me.id,
    createdAt: now, day: L.date, params, handicap: opp ? G.handicaps(meP, opp, cfg) : { [me.id]: 1 },
    scores: {}, attempts: {}, names: Object.fromEntries(players.map((id) => [id, personName(cfg, id)])),
  };
  if (mode.solo) {
    b.acceptedAt = b.startAt = now;
    b.endAt = endOfLocalDay(cfg, now);
    b.pb = (xd.pb || {})[params.choreId] ?? null;
  }
  const ref = await db.collection("battles").add(b);
  if (opp) await pushTo([opp.id], `⚔️ ${meP.name} challenged you!`, `${mode.emoji} ${mode.name}. Open Boon Bank to accept or pass.`);
  return { id: ref.id };
});

exports.respondBattle = onCall(async (req) => {
  const cfg = await getConfig();
  const me = await actor(req, cfg);
  const id = String((req.data && req.data.id) || "");
  const accept = !!(req.data && req.data.accept);
  const ref = db.doc(`battles/${id}`);
  const b = await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new HttpsError("not-found", "That battle is gone.");
    const b = s.data();
    if (b.players[1] !== me.id) throw new HttpsError("permission-denied", "That challenge isn't for you.");
    if (b.status !== "pending") throw new HttpsError("failed-precondition", "That challenge already ended.");
    const now = Date.now();
    if (!accept) {
      t.update(ref, { status: "declined", live: false, respondedAt: now });
      return { ...b, status: "declined" };
    }
    if (G.inQuietHours(localParts(tzOf(cfg)).hm, cfg)) throw new HttpsError("failed-precondition", "Battles are asleep right now.");
    const eod = endOfLocalDay(cfg, now);
    const endAt = b.mode === "blitz" && b.params.windowMin ? Math.min(eod, now + b.params.windowMin * 60000) : eod;
    t.update(ref, { status: "active", respondedAt: now, acceptedAt: now, startAt: now, endAt });
    return { ...b, status: "active" };
  });
  const mode = G.modeById(b.mode);
  await pushTo([b.challenger], accept ? `⚔️ ${personName(cfg, me.id)} accepted!` : `${personName(cfg, me.id)} said not now`,
    accept ? `${mode.emoji} ${mode.name} is on. Go go go!` : "Maybe later.");
  return { ok: true };
});

exports.cancelBattle = onCall(async (req) => {
  const cfg = await getConfig();
  const id = String((req.data && req.data.id) || "");
  const ref = db.doc(`battles/${id}`);
  const parent = isParentAuth(req.auth) && !(req.data && req.data.as);
  const me = parent ? null : await actor(req, cfg);
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new HttpsError("not-found", "That battle is gone.");
    const b = s.data();
    if (!b.live || b.status === "done") throw new HttpsError("failed-precondition", "That battle already ended.");
    const own = me && b.challenger === me.id && (b.status === "pending" || (b.mode === "ghost" && b.status === "active"));
    if (!parent && !own) throw new HttpsError("permission-denied", "Only a parent can call off a battle that started.");
    t.update(ref, { status: "cancelled", live: false, cancelledAt: Date.now(), cancelledBy: parent ? (req.auth.token.name || req.auth.token.email) : me.id });
  });
  return { ok: true };
});

exports.startAttempt = onCall(async (req) => {
  const cfg = await getConfig();
  const me = await actor(req, cfg);
  const ref = db.doc(`battles/${String((req.data && req.data.id) || "")}`);
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    const b = s.exists ? s.data() : null;
    if (!b || !b.players.includes(me.id) || !G.TIMED.includes(b.mode)) throw new HttpsError("not-found", "No timed battle here.");
    if (b.status !== "active") throw new HttpsError("failed-precondition", "That battle isn't running.");
    if ((b.attempts || {})[me.id]) throw new HttpsError("failed-precondition", "You already started.");
    t.update(ref, { [`attempts.${me.id}`]: { startAt: Date.now() } });
  });
  return { ok: true };
});

exports.finishAttempt = onCall(async (req) => {
  const cfg = await getConfig();
  const me = await actor(req, cfg);
  const id = String((req.data && req.data.id) || "");
  const ref = db.doc(`battles/${id}`);
  const s = await ref.get();
  const b = s.exists ? s.data() : null;
  const at = b && (b.attempts || {})[me.id];
  if (!b || !at || at.ms != null || at.void || b.status !== "active") throw new HttpsError("failed-precondition", "No run in progress.");
  const stopAt = Date.now();
  const ms = stopAt - at.startAt;
  let upd;
  if (ms > G.MAX_TRIAL_MS) upd = { ...at, void: "Took longer than 2 hours" };
  else {
    try {
      const r = await logChore(me.id, b.params.choreId, me.by);
      upd = { ...at, stopAt, ms, entryId: r.entryId };
    } catch (e) {
      upd = { ...at, void: e.message || "Couldn't log the chore" };
    }
  }
  await db.runTransaction(async (t) => {
    const s2 = await t.get(ref);
    const b2 = s2.data();
    if (b2.status !== "active") return;
    b2.attempts = { ...(b2.attempts || {}), [me.id]: upd };
    const result = G.decide(b2, {}, cfg.chores, false);
    const u = { [`attempts.${me.id}`]: upd };
    if (result) Object.assign(u, settle(b2, result));
    t.update(ref, u);
  });
  if (upd.void) throw new HttpsError("failed-precondition", `That run didn't count: ${upd.void}.`);
  await afterSettle(cfg, id);
  return { ms };
});

// Status changes once a result is decided. No-contest battles end right away.
function settle(b, result) {
  const now = Date.now();
  if (result.noContest) return { status: "done", result: { ...result, decidedAt: now } };
  const fast = G.TIMED.includes(b.mode) && Object.values(b.attempts || {}).some((a) => a.ms != null && a.ms < G.MIN_TRIAL_MS);
  return { status: "confirming", result: { ...result, decidedAt: now, needsParent: fast } };
}

// Pays XP for a finished battle (idempotent), then takes it off the live list.
async function afterSettle(cfg, id) {
  const ref = db.doc(`battles/${id}`);
  const s = await ref.get();
  if (!s.exists) return;
  const b = s.data();
  if (b.status === "confirming" && b.live && !b.notified) {
    await ref.update({ notified: true });
    await pushTo(b.players, "⚔️ Battle over!", "Open Boon Bank to see who won.");
  }
  if (b.status !== "done" || !b.live) return;
  const mode = G.modeById(b.mode);
  const xp = G.battleXp(b, b.result);
  const r = b.result || {};
  const ages = Object.fromEntries(b.players.map((p) => [p, G.effAge(cfg.kids.find((k) => k.id === p) || {}, G.gameCfg(cfg).battles.adultAge)]));
  for (const p of b.players) {
    const won = r.winner === p;
    const loserAge = b.players.filter((o) => o !== p).map((o) => ages[o])[0];
    const count = [r.tie ? "tie" : won ? "win" : "loss"];
    if (won && loserAge != null && ages[p] < loserAge) count.push("giant");
    const label = r.record ? "record set" : r.tie ? "tie" : won ? (b.mode === "ghost" ? "new best" : "won") : "played";
    const pbMs = b.mode === "ghost" && won && b.attempts[p] ? b.attempts[p].ms : null;
    await applyXp(p, xp[p] ? [{ key: "battle:" + id, amount: xp[p], reason: `${mode ? mode.name : "Battle"}: ${label}`, count }] : [],
      [], pbMs != null ? (x) => { x.pb = { ...(x.pb || {}), [b.params.choreId]: pbMs }; return true; } : null);
    await syncBadges(cfg, p);
  }
  await ref.update({ live: false, xp });
}

// Recomputes live scores for Race and Blitz battles after a chore is logged or reversed.
async function updateBattlesFor(cfg, personId) {
  const snap = await db.collection("battles").where("live", "==", true).get();
  for (const d of snap.docs) {
    const b = d.data();
    if (b.status !== "active" || !b.players.includes(personId) || !["race", "blitz"].includes(b.mode)) continue;
    await refreshBattle(cfg, d.id, Date.now());
  }
}

// Brings one active battle up to date: scores, voided runs, and the result once decided.
async function refreshBattle(cfg, id, now) {
  const ref = db.doc(`battles/${id}`);
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) return;
    const b = s.data();
    if (b.status !== "active") return;
    const u = {};
    if (G.TIMED.includes(b.mode)) {
      for (const [p, a] of Object.entries(b.attempts || {})) {
        if (a.ms == null && !a.void && now - a.startAt > G.MAX_TRIAL_MS) {
          b.attempts[p] = { ...a, void: "Took longer than 2 hours" };
          u[`attempts.${p}`] = b.attempts[p];
        }
      }
    }
    const entriesBy = G.TIMED.includes(b.mode) ? {} : await battleEntries(cfg, b);
    if (!G.TIMED.includes(b.mode)) u.scores = b.scores = G.battleScores(b, entriesBy, cfg.chores);
    const result = G.decide(b, entriesBy, cfg.chores, now >= b.endAt);
    if (result) Object.assign(u, settle(b, result));
    if (Object.keys(u).length) t.update(ref, u);
  });
  await afterSettle(cfg, id);
}

exports.confirmResult = onCall(async (req) => {
  const cfg = await getConfig();
  const id = String((req.data && req.data.id) || "");
  const action = String((req.data && req.data.action) || "confirm");
  const ref = db.doc(`battles/${id}`);
  const parentMode = isParentAuth(req.auth) && !(req.data && req.data.as);
  const me = parentMode ? null : await actor(req, cfg);
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new HttpsError("not-found", "That battle is gone.");
    const b = s.data();
    if (b.status !== "confirming") throw new HttpsError("failed-precondition", "That result is already settled.");
    const r = b.result || {};
    const now = Date.now();
    if (parentMode) {
      const email = String(req.auth.token.email).toLowerCase();
      const own = b.players.some((p) => { const k = cfg.kids.find((x) => x.id === p); return k && k.email && k.email.toLowerCase() === email; });
      if (own) throw new HttpsError("permission-denied", "Another parent has to check a battle you're in.");
      const by = req.auth.token.name || req.auth.token.email;
      if (action === "void") t.update(ref, { status: "done", result: { ...r, winner: null, tie: false, noContest: true, reason: "Called off by a parent", confirmedBy: by, confirmedAt: now } });
      else if (action === "confirm") t.update(ref, { status: "done", result: { ...r, confirmedBy: by, confirmedAt: now } });
      else throw new HttpsError("invalid-argument", "Unknown action.");
      return;
    }
    if (!b.players.includes(me.id) || b.players.length < 2) throw new HttpsError("permission-denied", "A parent has to check this one.");
    if (r.winner === me.id) throw new HttpsError("permission-denied", "The other player or a parent has to confirm your win.");
    if (action === "dispute") {
      t.update(ref, { result: { ...r, needsParent: true, disputedBy: me.id, disputedAt: now } });
    } else if (action === "confirm") {
      if (r.needsParent) throw new HttpsError("failed-precondition", "A parent has to check this one.");
      t.update(ref, { status: "done", result: { ...r, confirmedBy: me.id, confirmedAt: now } });
    } else throw new HttpsError("invalid-argument", "Unknown action.");
  });
  await afterSettle(cfg, id);
  return { ok: true };
});

// Every 5 minutes: expire old challenges, end timed-out battles, auto-confirm results.
async function runBattleTick(now = Date.now()) {
  const cfg = await getConfig();
  if (!cfg) return;
  const snap = await db.collection("battles").where("live", "==", true).get();
  for (const d of snap.docs) {
    const b = d.data();
    try {
      if (b.status === "pending" && now - b.createdAt > MS_PENDING) {
        await d.ref.update({ status: "expired", live: false });
      } else if (b.status === "active") {
        await refreshBattle(cfg, d.id, now);
      } else if (b.status === "confirming") {
        const age = now - ((b.result && b.result.decidedAt) || b.createdAt);
        const r = b.result || {};
        if (!r.needsParent && age >= MS_AUTOCONFIRM) {
          await d.ref.update({ status: "done", result: { ...r, confirmedBy: "auto", confirmedAt: now } });
        } else if (r.needsParent && age >= MS_PARENT_WAIT) {
          await d.ref.update({ status: "done", result: { ...r, winner: null, tie: false, noContest: true, reason: "No parent checked it in time" } });
        }
        await afterSettle(cfg, d.id);
      } else if (b.status === "done") {
        await afterSettle(cfg, d.id);
      } else {
        await d.ref.update({ live: false });
      }
    } catch (e) {
      console.error("battle tick failed", d.id, e);
    }
  }
}
exports.battleTick = onSchedule({ schedule: "every 5 minutes", timeZone: FAMILY_TZ }, () => runBattleTick());

// Emulator-only hooks so tests can run scheduled jobs at a chosen time. Never deployed.
if (process.env.FUNCTIONS_EMULATOR === "true") {
  exports.testHooks = onCall(async (req) => {
    const what = req.data && req.data.run;
    if (what === "tick") await runBattleTick(Number(req.data.now) || Date.now());
    else if (what === "freezes") await runFreezes();
    return { ok: true };
  });
}
