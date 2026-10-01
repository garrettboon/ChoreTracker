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
// Chores that make the kid say what they actually did (a chore named "Parent choice" does by default).
const needsNote = (c) => c.ask === true || (c.ask == null && /parent'?s?\s*choice/i.test(c.name || ""));
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

// Hour of the day (0-23) of a timestamp in a time zone; 24 when there is no timestamp.
const hourIn = (tz, t) => (Number.isFinite(t) ? Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date(t))) : 24);
// A chore done before 9 AM family time counts toward the morning badges.
const isEarly = (tz, e) => hourIn(tz, e.t) < G.EARLY_HOUR;

// Logs one chore inside a transaction. Shared by completeChore and Time Trial finishes.
function logChore(kidId, choreId, by, note = "", ms = 0) {
  return db.runTransaction(async (t) => {
    const cfg = (await t.get(db.doc("app/config"))).data();
    const kid = cfg && cfg.kids.find((k) => k.id === kidId);
    const ch = cfg && cfg.chores.find((c) => c.id === choreId && c.kind === "family");
    if (!kid || !ch) throw new HttpsError("invalid-argument", "Unknown chore.");
    if (!by && !kid.adult && needsNote(ch) && !note) throw new HttpsError("invalid-argument", "Say what the chore was first.");
    if (ch.assign !== "pool" && ch.assign !== kidId) throw new HttpsError("permission-denied", "That chore belongs to someone else.");

    const L = localParts(cfg.timezone || FAMILY_TZ);
    const mon = mondayOf(L.date, L.dow), sun = addDays(mon, 6);
    // Everyone's entries count toward the family's totals for today and this week (grown-ups included);
    // only this person's entries count toward the max per person.
    const refs = [];
    for (const k of cfg.kids) for (const wk of [mon, addDays(mon, 7)]) refs.push(db.doc(`weeks/${wk}_${k.id}`));
    const snaps = await t.getAll(...refs);
    const ownIds = new Set([mon, addDays(mon, 7)].map((w) => `${w}_${kidId}`));
    let me = 0, fam = 0, week = 0;
    for (const s of snaps) {
      if (!s.exists) continue;
      for (const e of s.data().entries || []) {
        if (e.choreId !== choreId || e.status === "reversed") continue;
        if (e.date === L.date) { fam++; if (ownIds.has(s.id)) me++; }
        if (e.date >= mon && e.date <= sun) week++;
      }
    }
    if (ch.weekLimit > 0 && week >= ch.weekLimit) throw new HttpsError("failed-precondition", "That one's done for this week.");
    if (ch.familyLimit > 0 && fam >= ch.familyLimit) throw new HttpsError("failed-precondition", "That one's done for today.");
    if (me >= (ch.limit || 1)) throw new HttpsError("failed-precondition", "That one's at its max per person for today.");

    const thisWeek = snaps.find((s) => s.id === `${mon}_${kidId}`);
    const wk = thisWeek && thisWeek.exists && thisWeek.data().closed ? addDays(mon, 7) : mon;
    const amount = Math.round((kid.rate || 0) * (ch.mult || 1) * 100) / 100;
    const entry = {
      id: crypto.randomBytes(5).toString("hex"), t: Date.now(), type: "chore",
      choreId, name: ch.name, amount, date: L.date, status: "ok",
    };
    if (by) entry.by = by;
    if (note) entry.detail = note;
    if (ms > 0 && ms <= 6 * 3600 * 1000) entry.ms = Math.round(ms); // how long it took, from the full-screen timer
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
  const note = String((req.data && req.data.note) || "").trim().slice(0, 200);
  let by = null;
  if (isParentAuth(auth)) {
    by = auth.token.name || auth.token.email;
  } else {
    const dev = await db.doc(`devices/${auth.uid}`).get();
    if (!dev.exists || dev.data().role !== "kid" || dev.data().kidId !== kidId) {
      throw new HttpsError("permission-denied", "This device can't log chores for that person.");
    }
  }
  const r = await logChore(kidId, choreId, by, note, Number((req.data && req.data.ms) || 0));
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
// Days the app marked complete (prefs.prDone). They stay complete even if the checklist changes later.
const doneDates = (prefs) => Object.keys((prefs && prefs.prDone) || {}).filter((d) => prefs.prDone[d]);
// Milliseconds until the next local midnight.
function endOfLocalDay(cfg, now = Date.now()) {
  const L = localParts(tzOf(cfg), new Date(now));
  return now + ((24 * 60 - toMin(L.hm)) * 60 - new Date(now).getUTCSeconds()) * 1000;
}
const personName = (cfg, id) => ((cfg.kids.find((k) => k.id === id) || {}).name || "Someone");

// Who the caller is acting as. Kid tablets act as their paired person. A signed-in parent
// acts as the person passed in `as` (their own adult tab, or a kid's screen opened from Views).
// An adult profile with an email set belongs to that parent only.
async function actor(req, cfg) {
  const auth = req.auth;
  if (!auth) throw new HttpsError("unauthenticated", "Not signed in.");
  if (isParentAuth(auth)) {
    const as = String((req.data && req.data.as) || "");
    const p = cfg.kids.find((k) => k.id === as);
    if (!p) throw new HttpsError("permission-denied", "Open a person's screen first.");
    if (p.adult && p.email && p.email.toLowerCase() !== String(auth.token.email).toLowerCase()) {
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

// Sends to each person's paired tablets, and for grown-ups also to the phone they signed in on
// (a parent push token whose email matches the adult's profile email).
async function pushTo(ids, title, body) {
  try {
    const devices = (await db.collection("devices").where("role", "==", "kid").get()).docs;
    const targets = devices.filter((d) => ids.includes(d.data().kidId) && d.data().fcmToken);
    const cfg = await getConfig();
    const emails = ((cfg && cfg.kids) || []).filter((k) => ids.includes(k.id) && k.adult && k.email).map((k) => k.email.toLowerCase());
    if (emails.length) {
      const phones = (await db.collection("parentTokens").get()).docs;
      targets.push(...phones.filter((d) => d.data().fcmToken && emails.includes(String(d.data().email || "").toLowerCase())));
    }
    await sendPush(targets, { title, body });
  } catch (e) {
    console.warn("push failed", e);
  }
}
// Parents who asked to hear about every battle in the family (Game tab switch).
async function pushBattleFeed(title, body, skipIds = []) {
  try {
    const cfg = await getConfig();
    const skip = ((cfg && cfg.kids) || []).filter((k) => skipIds.includes(k.id) && k.email).map((k) => k.email.toLowerCase());
    const docs = (await db.collection("parentTokens").get()).docs
      .filter((d) => d.data().fcmToken && d.data().battleFeed && !skip.includes(String(d.data().email || "").toLowerCase()));
    await sendPush(docs, { title, body });
  } catch (e) {
    console.warn("battle feed push failed", e);
  }
}
// A short line for one player's result: "🏆 You won the Race! +40 XP"
function resultPush(cfg, b, p, xp) {
  const mode = G.modeById(b.mode) || { emoji: "⚔️", name: "battle" };
  const r = b.result || {};
  const plus = xp ? ` +${xp} XP.` : "";
  if (r.noContest) return [`${mode.emoji} ${mode.name}: no contest`, `${r.reason || "Nobody earned XP."}`];
  if (b.mode === "ghost") return [r.winner ? `👻 ${r.record ? "Record set" : "New personal best"}!` : "👻 Not this time", `${r.winner ? "Your time counts." : "Try again to beat your best."}${plus}`];
  if (G.isRaid(b.mode)) return [r.winnerSide ? `${mode.emoji} Boss beaten!` : `${mode.emoji} The boss got away`, `${r.reason || ""}${plus}`];
  if (r.tie) return [`${mode.emoji} ${mode.name}: it's a tie!`, `${r.reason || ""}${plus}`];
  if (G.isWinner(b, r, p)) return [`🏆 You won the ${mode.name}!`, `${r.reason || ""}${plus}`];
  const who = r.winnerSide ? b.teams[r.winnerSide].map((q) => personName(cfg, q)).join(" and ") : personName(cfg, r.winner);
  return [`${mode.emoji} ${who} won the ${mode.name}`, `Good try!${plus}`];
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
  const frozen = [...((x.exists && x.data().frozenDates) || []), ...doneDates(prefs)];
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
    adds.push({ key: "chore:" + e.id, amount, reason: e.name || ch.name || "Chore", count: isEarly(tzOf(cfg), e) ? ["chore", "early"] : ["chore"] });
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
  const tz = tzOf(cfg);
  const earlyBest = Math.max(xd.earlyBest || 0, G.bestMorning(ws.flatMap((s) => (s.exists ? s.data().entries || [] : [])).map((e) => ({ ...e, hour: hourIn(tz, e.t) }))));
  const list = G.badgeList({
    chores: (st.chores || 0) + live, goalHits: st.goalHits || 0, redemptions: st.redemptions || 0,
    early: counts.early || 0, earlyBest,
    bestStreak: G.bestStreak(prefs.prLog, prIdsOf(cfg), [...(xd.frozenDates || []), ...doneDates(prefs)]),
    saved, invest: bank.invest || 0, give: bank.give || 0, bought: archived.length,
    wins: counts.win || 0, giant: counts.giant || 0, level: xd.maxLevel || 1,
    quests: counts.quest || 0, bounties: counts.bounty || 0, checklistDays: counts.pr || 0,
  });
  await applyXp(personId, list.filter((x) => x[3]).map((x) => ({
    key: "badge:" + x[0], amount: G.XP.badge, reason: "Badge: " + x[2], count: ["badge"],
  })), [], (x) => { if (earlyBest > (x.earlyBest || 0)) { x.earlyBest = earlyBest; return true; } return false; });
}

// Checklist XP and streak milestones. `sinceDate` limits milestones to runs reaching them
// on or after that date (triggers only pay for today and yesterday).
function checklistXp(cfg, prLog, done, frozen, dates, sinceDate) {
  const prIds = prIdsOf(cfg);
  const adds = [];
  for (const d of dates) {
    if (G.dayComplete(prLog, prIds, d, done)) adds.push({ key: "pr:" + d, amount: G.XP.checklist, reason: "Daily checklist done", count: ["pr"] });
  }
  for (const m of G.streakMilestones(prLog, prIds, [...frozen, ...done])) {
    if (!sinceDate || m.date >= sinceDate) {
      adds.push({ key: m.key, amount: m.amount, reason: `${m.days}-day streak`, count: ["streak"], freeze: m.days === 30 });
    }
  }
  return adds;
}
// Keeps bestStreak current and refunds a freeze if the frozen day was completed after all.
function streakMutator(cfg, prLog, done) {
  const prIds = prIdsOf(cfg);
  return (x) => {
    let changed = false;
    const best = G.bestStreak(prLog, prIds, [...(x.frozenDates || []), ...done]);
    if (best > (x.bestStreak || 0)) { x.bestStreak = best; changed = true; }
    const refund = (x.frozenDates || []).filter((d) => G.dayComplete(prLog, prIds, d, done));
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
  await evalQuests(cfg, w.kidId);
});

exports.onPrefsWrite = onDocumentWritten("prefs/{id}", async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : {};
  const after = event.data.after.exists ? event.data.after.data() : null;
  const personId = event.params.id;
  const same = (k) => JSON.stringify(before[k] || {}) === JSON.stringify(after[k] || {});
  if (!after || (same("prLog") && same("prDone"))) return;
  const cfg = await getConfig();
  if (!cfg || !cfg.kids.some((k) => k.id === personId)) return;
  const today = localParts(tzOf(cfg)).date, yesterday = addDays(today, -1);
  const xs = await db.doc(`xp/${personId}`).get();
  const frozen = (xs.exists && xs.data().frozenDates) || [];
  const done = doneDates(after);
  await applyXp(personId, checklistXp(cfg, after.prLog, done, frozen, [today, yesterday], yesterday), [], streakMutator(cfg, after.prLog, done));
  await syncBadges(cfg, personId);
  await evalQuests(cfg, personId);
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
  const done = doneDates(p.exists ? p.data() : {});
  const frozen = (x.exists && x.data().frozenDates) || [];
  adds.push(...checklistXp(cfg, prLog, done, frozen, [...new Set([...Object.keys(prLog), ...done])], null));
  ((b.exists && b.data().archived) || []).forEach((a, i) => adds.push({
    key: "buy:" + i, amount: G.XP.savingsGoal, reason: "Bought: " + (a.name || "savings goal"), count: ["sgoal"],
  }));
  await applyXp(personId, adds, [], streakMutator(cfg, prLog, done));
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
    const frozen = [...(x.data().frozenDates || []), ...doneDates(p.exists ? p.data() : {})];
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
const SPEED = ["race", "blitz", "timetrial", "ghost", "territory", "bingo", "grownups", "roomrush", "doom"]; // results someone confirms
const LIVE_SCORED = ["race", "blitz", "territory", "bingo", "raid", "babyraid", "grownups"];         // scored from chores as they happen

const dowOf = (date) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const mondayOfDate = (date) => mondayOf(date, dowOf(date));
const kidOf = (cfg, id) => cfg.kids.find((k) => k.id === id);

// Chore entries per player from the week docs covering the battle's days.
async function battleEntries(cfg, b) {
  const days = Math.max(1, (b.params && b.params.days) || 1);
  const mons = new Set();
  for (let i = 0; i < days; i++) { const m = mondayOfDate(addDays(b.day, i)); mons.add(m); mons.add(addDays(m, 7)); }
  const refs = [];
  for (const p of b.players) for (const wk of mons) refs.push(db.doc(`weeks/${wk}_${p}`));
  const snaps = await db.getAll(...refs);
  const out = {};
  b.players.forEach((p) => { out[p] = []; });
  for (const s of snaps) if (s.exists) out[s.data().kidId] = (out[s.data().kidId] || []).concat(s.data().entries || []);
  return out;
}

// How many more times a chore can be done today: each player's own room under the max per person,
// and the family's shared room under its max per day and max per week.
async function choreRoom(cfg, ch, playerIds) {
  const L = localParts(tzOf(cfg));
  const mon = mondayOf(L.date, L.dow), sun = addDays(mon, 6);
  const ids = [...new Set([...cfg.kids.map((k) => k.id), ...playerIds])];
  const snaps = await db.getAll(...ids.flatMap((id) => [mon, addDays(mon, 7)].map((wk) => db.doc(`weeks/${wk}_${id}`))));
  const doneBy = {};
  let fam = 0, week = 0;
  for (const s of snaps) {
    if (!s.exists) continue;
    const id = s.id.slice(s.id.indexOf("_") + 1);
    for (const e of s.data().entries || []) {
      if (e.choreId !== ch.id || e.status === "reversed") continue;
      if (e.date === L.date) { fam++; doneBy[id] = (doneBy[id] || 0) + 1; }
      if (e.date >= mon && e.date <= sun) week++;
    }
  }
  const own = {};
  for (const id of playerIds) own[id] = (ch.limit || 1) - (doneBy[id] || 0);
  const shared = Math.min(ch.familyLimit > 0 ? ch.familyLimit - fam : Infinity, ch.weekLimit > 0 ? ch.weekLimit - week : Infinity);
  return { own, shared };
}
// Every player can still do the chore today, and the family's limits leave room for all of them.
async function checkChoreFor(cfg, ch, players) {
  const room = await choreRoom(cfg, ch, players);
  return players.every((id) => room.own[id] >= 1) && room.shared >= players.length;
}

async function pushParents(title, body) {
  try {
    const docs = (await db.collection("parentTokens").get()).docs.filter((d) => d.data().fcmToken);
    await sendPush(docs, { title, body });
  } catch (e) {
    console.warn("parent push failed", e);
  }
}

exports.createBattle = onCall(async (req) => {
  const cfg = await getConfig();
  if (!cfg) throw new HttpsError("failed-precondition", "No family setup yet.");
  const me = await actor(req, cfg);
  const data = req.data || {};
  const bc = G.gameCfg(cfg).battles;
  if (!bc.enabled) throw new HttpsError("failed-precondition", "Battles are turned off right now.");
  const picked = G.modeById(String(data.mode || ""));
  if (!picked || picked.soon) throw new HttpsError("invalid-argument", "That battle mode isn't ready yet.");
  if ((bc.modesOff || []).includes(picked.id)) throw new HttpsError("failed-precondition", `A parent turned off ${picked.name}.`);
  const xs = await db.doc(`xp/${me.id}`).get();
  const xd = xs.exists ? xs.data() : {};
  if ((xd.maxLevel || 1) < picked.level) throw new HttpsError("failed-precondition", `Reach level ${picked.level} to unlock ${picked.name}.`);
  const L = localParts(tzOf(cfg));
  if (G.inQuietHours(L.hm, cfg)) throw new HttpsError("failed-precondition", "Battles are asleep right now. Try again in the morning.");
  const meP = kidOf(cfg, me.id);
  const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(String))].filter((id) => id !== me.id);

  // Who's in it.
  let players, teams = null, opp = null;
  if (picked.solo) players = [me.id];
  else if (G.isRaid(picked.id)) {
    const mates = ids(data.team).filter((id) => kidOf(cfg, id));
    if (picked.id === "raid" && !mates.length) throw new HttpsError("invalid-argument", "Pick 1 to 3 teammates.");
    if (mates.length > 3) throw new HttpsError("invalid-argument", "Pick up to 3 teammates.");
    players = [me.id, ...mates];
    teams = { a: players };
  } else if (picked.id === "grownups") {
    const mySide = !!meP.adult;
    const mates = ids(data.team).filter((id) => kidOf(cfg, id) && !!kidOf(cfg, id).adult === mySide);
    const opps = ids(data.opponents).filter((id) => kidOf(cfg, id) && !!kidOf(cfg, id).adult !== mySide);
    if (!opps.length) throw new HttpsError("invalid-argument", mySide ? "Pick at least one kid to battle." : "Pick at least one grown-up to battle.");
    players = [me.id, ...mates, ...opps];
    teams = { a: [me.id, ...mates], b: opps };
  } else {
    opp = kidOf(cfg, String(data.opponent || ""));
    if (!opp || opp.id === me.id) throw new HttpsError("invalid-argument", "Pick someone to challenge.");
    players = [me.id, opp.id];
  }

  // Wildcard: pick a random mode and twist.
  let mode = picked, twist = null;
  const pool = cfg.chores.filter((c) => c.kind === "family" && c.assign === "pool" && !needsNote(c));
  if (picked.id === "wildcard") {
    const allKids = players.every((id) => !kidOf(cfg, id).adult);
    const options = G.WILDCARD_MODES.filter((m) => m !== "territory" || (allKids && pool.length)).filter((m) => m !== "bingo" || pool.length);
    mode = G.modeById(options[Math.floor(Math.random() * options.length)]);
    const tw = pool[Math.floor(Math.random() * pool.length)];
    if (tw && mode.id !== "bingo") twist = { choreId: tw.id, text: `${tw.name} counts double` };
  }
  if (mode.kidsOnly && players.some((id) => kidOf(cfg, id).adult)) throw new HttpsError("invalid-argument", `${mode.name} is for kids only.`);

  const params = {};
  if (mode.id === "race") params.n = Math.min(6, Math.max(2, Math.round(Number(data.n) || 3)));
  if (G.TIMEBOX_MODES.includes(mode.id)) params.windowMin = G.timeLimit(cfg, mode.id, picked.id === "wildcard" ? null : data.windowMin);
  if (mode.id === "raid") params.days = Math.min(3, Math.max(1, Math.round(Number(data.days) || 1)));
  if (mode.id === "babyraid") params.days = 1;
  if (G.TIMED.includes(mode.id) || mode.id === "judge") {
    const ch = cfg.chores.find((c) => c.id === String(data.choreId || "") && c.kind === "family");
    if (!ch) throw new HttpsError("invalid-argument", "Pick a chore.");
    if (needsNote(ch)) throw new HttpsError("invalid-argument", "Pick a chore that doesn't need a description.");
    if (mode.id !== "ghost" && ch.assign !== "pool") throw new HttpsError("invalid-argument", `${mode.name} needs an Anyone chore.`);
    if (mode.id === "ghost" && ch.assign !== "pool" && ch.assign !== me.id) throw new HttpsError("invalid-argument", "That chore belongs to someone else.");
    if (!(await checkChoreFor(cfg, ch, players))) throw new HttpsError("failed-precondition", `There isn't enough "${ch.name}" left today for this battle.`);
    params.choreId = ch.id;
    params.choreName = ch.name;
  }
  if (mode.id === "bingo") {
    if (!pool.length) throw new HttpsError("failed-precondition", "Bingo needs at least one Anyone chore.");
    const seed = `${L.date}:${players.join(",")}:${Date.now()}`;
    params.card = G.bingoCard(pool.map((c) => c.id), seed);
    params.cardNames = params.card.map((id) => (pool.find((c) => c.id === id) || {}).name || id);
    params.free = G.bingoFree(meP, opp, cfg, seed);
  }
  if (mode.id === "roomrush") {
    params.room = String(data.room || "").replace(/\s+/g, " ").trim().slice(0, 30) || G.ROOMS[0];
    const min = Math.round(Number(data.minutes));
    params.minutes = G.RUSH_MINUTES.includes(min) ? min : 2;
  }
  if (mode.id === "territory") {
    if (!pool.length) throw new HttpsError("failed-precondition", "Territory needs at least one Anyone chore.");
    const m = G.territoryMap(`${L.date}:${players.join(",")}:${Date.now()}`);
    params.map = { cols: m.cols, rows: m.rows, cells: m.cells, names: m.names };
    params.homes = { [players[0]]: m.homes[0], [players[1]]: m.homes[1] };
  }
  if (mode.id === "streakduel") { params.startDate = addDays(L.date, 1); params.endDate = addDays(L.date, 14); }
  if (mode.id === "showdown") params.week = mondayOf(L.date, L.dow);

  // Guardrails: one live battle per group, a daily cap, a cooldown after a decline.
  const [liveSnap, weekSnap] = await Promise.all([
    db.collection("battles").where("live", "==", true).get(),
    db.collection("battles").where("day", ">=", mondayOf(L.date, L.dow)).get(),
  ]);
  const live = liveSnap.docs.map((d) => d.data());
  const overlap = (b) => b.players.filter((p) => players.includes(p)).length;
  if (players.length > 1 && live.some((b) => b.mode !== "ghost" && overlap(b) >= 2)) {
    throw new HttpsError("failed-precondition", opp ? `You and ${opp.name} already have a battle going.` : "Some of you already have a battle going.");
  }
  if (mode.solo && live.some((b) => b.mode === "ghost" && b.players[0] === me.id)) {
    throw new HttpsError("failed-precondition", "Finish your ghost race first.");
  }
  const thisWeek = weekSnap.docs.map((d) => d.data());
  for (const p of players) {
    const lim = G.battleLimit(cfg, picked.id, thisWeek, p, L.date, mondayOf(L.date, L.dow));
    if (lim) throw new HttpsError("failed-precondition", G.battleLimitText(lim, p === me.id ? null : kidOf(cfg, p).name));
  }
  if (players.length > 1 && weekSnap.docs.some((d) => {
    const b = d.data();
    if (b.day !== L.date) return false;
    return b.status === "declined" && b.players.includes(me.id) && players.includes(b.declinedBy || b.players[1]) && b.respondedAt > Date.now() - MS_COOLDOWN;
  })) throw new HttpsError("failed-precondition", "They said not now. Try again in an hour.");

  const now = Date.now();
  const b = {
    mode: mode.id, status: mode.solo ? "active" : "pending", live: true, players, challenger: me.id,
    createdAt: now, day: L.date, params, scores: {}, attempts: {}, accepted: { [me.id]: true },
    names: Object.fromEntries(players.map((id) => [id, personName(cfg, id)])),
  };
  if (picked.id === "wildcard") b.wildcard = true;
  if (twist) b.twist = twist;
  if (teams) {
    b.teams = teams;
    if (teams.b) b.teamHandicap = G.teamHandicaps(teams.a.map((id) => kidOf(cfg, id)), teams.b.map((id) => kidOf(cfg, id)), cfg);
    b.handicap = {};
  } else b.handicap = opp ? G.handicaps(meP, opp, cfg) : { [me.id]: 1 };
  if (G.isRaid(mode.id)) {
    const fam = await db.doc("xp/_family").get(), fd = (fam.exists && fam.data()) || {};
    if (mode.id === "babyraid") {
      const boss = G.babyBossFor(fd.babyBossesBeaten || 0);
      Object.assign(params, { bossId: boss.id, bossName: boss.name, bossEmoji: boss.emoji, tier: 0, hp: G.babyRaidHp(players.length) });
    } else {
      const boss = G.bossFor(fd.bossesBeaten || 0);
      Object.assign(params, { bossId: boss.id, bossName: boss.name, bossEmoji: boss.emoji, tier: boss.tier, hp: G.raidHp(players.length, params.days, boss.tier) });
    }
    // A raid with nobody to invite (a solo Baby Boss Raid) starts right away.
    if (players.length === 1) Object.assign(b, { status: "active", acceptedAt: now }, startWindow(cfg, b, now));
  }
  if (mode.solo) {
    b.acceptedAt = b.startAt = now;
    b.endAt = startWindow(cfg, b, now).endAt;
    b.pb = (xd.pb || {})[params.choreId] ?? null;
  }
  const ref = await db.collection("battles").add(b);
  const others = players.filter((p) => p !== me.id);
  if (others.length) {
    const what = G.isRaid(mode.id) ? `Team up against ${params.bossEmoji} ${params.bossName}!` : `${picked.emoji} ${picked.name}.`;
    await pushTo(others, `⚔️ ${meP.name} challenged you!`, `${what} Open Boon Chores to accept or pass.`);
  }
  return { id: ref.id, mode: mode.id, twist };
});

// When an accepted battle starts and ends.
function startWindow(cfg, b, now) {
  const eod = endOfLocalDay(cfg, now);
  if (G.TIMEBOX_MODES.includes(b.mode) && b.params.windowMin) return { startAt: now, endAt: Math.min(eod, now + b.params.windowMin * 60000) };
  if (G.isRaid(b.mode)) return { startAt: now, endAt: eod + ((b.params.days || 1) - 1) * 86400000 };
  if (b.mode === "streakduel") return { startAt: eod, endAt: eod + 14 * 86400000 };
  if (b.mode === "showdown") return { startAt: now, endAt: now + 8 * 86400000 };
  return { startAt: now, endAt: eod };
}

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
    if (!b.players.includes(me.id) || b.challenger === me.id) throw new HttpsError("permission-denied", "That challenge isn't for you.");
    if (b.status !== "pending") throw new HttpsError("failed-precondition", "That challenge already ended.");
    const now = Date.now();
    if (!accept) {
      t.update(ref, { status: "declined", live: false, respondedAt: now, declinedBy: me.id });
      return { ...b, status: "declined" };
    }
    if (G.inQuietHours(localParts(tzOf(cfg)).hm, cfg)) throw new HttpsError("failed-precondition", "Battles are asleep right now.");
    const accepted = { ...(b.accepted || {}), [me.id]: true };
    if (!b.players.every((p) => accepted[p])) {
      t.update(ref, { accepted });
      return { ...b, accepted };
    }
    t.update(ref, { accepted, status: "active", respondedAt: now, acceptedAt: now, ...startWindow(cfg, b, now) });
    return { ...b, status: "active" };
  });
  const mode = G.modeById(b.mode);
  if (!accept) await pushTo([b.challenger], `${personName(cfg, me.id)} said not now`, "Maybe later.");
  else if (b.status === "active") {
    await pushBattleFeed(`⚔️ ${mode.name} started`, b.players.map((p) => personName(cfg, p)).join(" vs "), b.players);
    await pushTo(b.players.filter((p) => p !== me.id), `⚔️ ${mode.name} is on!`,
      b.mode === "streakduel" ? "It starts tomorrow. Don't miss a day!" : "Go go go!");
  }
  return { ok: true, started: b.status === "active" };
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
    if (!b || !b.players.includes(me.id) || !(G.TIMED.includes(b.mode) || b.mode === "roomrush")) throw new HttpsError("not-found", "No timed battle here.");
    if (b.status !== "active") throw new HttpsError("failed-precondition", "That battle isn't running.");
    if ((b.attempts || {})[me.id]) throw new HttpsError("failed-precondition", "You already started.");
    if (b.mode === "doom" && !(b.dooms || {})[me.id]) throw new HttpsError("failed-precondition", "Spin the wheel first.");
    t.update(ref, { [`attempts.${me.id}`]: { startAt: Date.now() } });
  });
  return { ok: true };
});

// Finishes a Time Trial or Ghost Race run, or turns in the chore for Judge's Pick. Logs the chore.
exports.finishAttempt = onCall(async (req) => {
  const cfg = await getConfig();
  const me = await actor(req, cfg);
  const id = String((req.data && req.data.id) || "");
  const ref = db.doc(`battles/${id}`);
  const s = await ref.get();
  const b = s.exists ? s.data() : null;
  if (!b || !b.players.includes(me.id) || b.status !== "active") throw new HttpsError("failed-precondition", "That battle isn't running.");
  const judge = b.mode === "judge";
  const at = (b.attempts || {})[me.id] || (judge ? {} : null);
  if (!at || at.ms != null || at.void || at.entryId) throw new HttpsError("failed-precondition", judge ? "You already turned it in." : "No run in progress.");
  const stopAt = Date.now();
  const ms = judge ? null : stopAt - at.startAt;
  let upd;
  if (!judge && ms > G.MAX_TRIAL_MS) upd = { ...at, void: "Took longer than 2 hours" };
  else {
    try {
      const r = await logChore(me.id, b.params.choreId, me.by, "", judge ? 0 : ms);
      upd = judge ? { doneAt: stopAt, entryId: r.entryId } : { ...at, stopAt, ms, entryId: r.entryId };
    } catch (e) {
      upd = { ...at, void: e.message || "Couldn't log the chore" };
    }
  }
  let judging = false;
  await db.runTransaction(async (t) => {
    const s2 = await t.get(ref);
    const b2 = s2.data();
    if (b2.status !== "active") return;
    b2.attempts = { ...(b2.attempts || {}), [me.id]: upd };
    const u = { [`attempts.${me.id}`]: upd };
    if (judge) {
      if (b2.players.every((p) => b2.attempts[p] && b2.attempts[p].entryId)) {
        Object.assign(u, { status: "judging", result: { decidedAt: Date.now(), needsParent: true, reason: "Waiting for a parent to judge" } });
        judging = true;
      }
    } else {
      const result = G.decide(b2, {}, cfg.chores, false);
      if (result) Object.assign(u, settle(b2, result));
    }
    t.update(ref, u);
  });
  if (upd.void) throw new HttpsError("failed-precondition", `That didn't count: ${upd.void}.`);
  if (judging) await pushParents("🧑‍⚖️ Time to judge!", `${b.players.map((p) => personName(cfg, p)).join(" and ")} both did "${b.params.choreName}". Pick the better job in the Game tab.`);
  await afterSettle(cfg, id);
  return { ms };
});

// Territory: reveal a country's chore. The player has to finish it (or give the country up)
// before revealing another, and nobody else can take it meanwhile.
async function mapBattle(req, cfg, me) {
  const id = String((req.data && req.data.id) || "");
  const ref = db.doc(`battles/${id}`);
  const s = await ref.get();
  const b = s.exists ? s.data() : null;
  if (!b || !G.isMapTerritory(b) || !b.players.includes(me.id)) throw new HttpsError("not-found", "No Territory battle here.");
  return { id, ref, b };
}
const mapRunning = (b) => b.status === "active" && Date.now() < b.endAt;
exports.territoryPick = onCall(async (req) => {
  const cfg = await getConfig();
  const me = await actor(req, cfg);
  const { ref, b } = await mapBattle(req, cfg, me);
  const k = Number(req.data && req.data.country);
  if (!mapRunning(b)) throw new HttpsError("failed-precondition", "That battle isn't running.");
  const problem = G.pickProblem(b, me.id, k);
  if (problem) throw new HttpsError("failed-precondition", problem);
  // An Anyone chore this player can still do today, mixing them up across the battle.
  const ok = [];
  for (const ch of cfg.chores.filter((c) => c.kind === "family" && c.assign === "pool" && !needsNote(c))) {
    const room = await choreRoom(cfg, ch, [me.id]);
    if (room.own[me.id] >= 1 && room.shared >= 1) ok.push(ch);
  }
  if (!ok.length) throw new HttpsError("failed-precondition", "You've done every Anyone chore you can today.");
  const used = (ch) => Object.values(b.land || {}).filter((l) => l.by === me.id && l.choreId === ch.id).length;
  const least = Math.min(...ok.map(used));
  const fresh = ok.filter((ch) => used(ch) === least);
  const ch = fresh[Math.floor(Math.random() * fresh.length)];
  await db.runTransaction(async (t) => {
    const b2 = (await t.get(ref)).data();
    if (!mapRunning(b2)) throw new HttpsError("failed-precondition", "That battle isn't running.");
    const p2 = G.pickProblem(b2, me.id, k);
    if (p2) throw new HttpsError("failed-precondition", p2);
    t.update(ref, { [`open.${me.id}`]: { c: k, choreId: ch.id, name: ch.name, at: Date.now() } });
  });
  return { choreId: ch.id, name: ch.name, country: b.params.map.names[k] };
});
// Territory: the revealed chore is done. Logs it and claims the country.
exports.territoryClaim = onCall(async (req) => {
  const cfg = await getConfig();
  const me = await actor(req, cfg);
  const { id, ref, b } = await mapBattle(req, cfg, me);
  const open = (b.open || {})[me.id];
  if (!open) throw new HttpsError("failed-precondition", "Reveal a country's chore first.");
  const r = await logChore(me.id, open.choreId, me.by, "", Number((req.data && req.data.ms) || 0));
  let claimed = false;
  await db.runTransaction(async (t) => {
    const b2 = (await t.get(ref)).data();
    const o2 = (b2.open || {})[me.id];
    if (!o2 || o2.c !== open.c) return;
    const u = { [`open.${me.id}`]: FieldValue.delete() };
    // Too late for the battle still logs the chore; it just doesn't take the country.
    if (mapRunning(b2) && !G.countryOwner(b2, open.c)) {
      u[`land.${open.c}`] = { by: me.id, choreId: open.choreId, entryId: r.entryId, at: Date.now() };
      claimed = true;
    }
    t.update(ref, u);
  });
  await refreshBattle(cfg, id, Date.now());
  return { claimed, country: b.params.map.names[open.c], amount: r.amount };
});
// Territory: give up the revealed country. It stays neutral, and this player can't pick it again.
exports.territoryGiveUp = onCall(async (req) => {
  const cfg = await getConfig();
  const me = await actor(req, cfg);
  const { id, ref } = await mapBattle(req, cfg, me);
  await db.runTransaction(async (t) => {
    const b2 = (await t.get(ref)).data();
    const o2 = (b2.open || {})[me.id];
    if (!o2) throw new HttpsError("failed-precondition", "There's nothing to give up.");
    t.update(ref, { [`open.${me.id}`]: FieldValue.delete(), [`locked.${me.id}`]: FieldValue.arrayUnion(o2.c) });
  });
  await refreshBattle(cfg, id, Date.now());
  return { ok: true };
});

// Wheel of Doom: spin once before your run. The server picks, so nobody can re-spin for a better one.
exports.spinDoom = onCall(async (req) => {
  const cfg = await getConfig();
  const me = await actor(req, cfg);
  const ref = db.doc(`battles/${String((req.data && req.data.id) || "")}`);
  return db.runTransaction(async (t) => {
    const s = await t.get(ref);
    const b = s.exists ? s.data() : null;
    if (!b || b.mode !== "doom" || !b.players.includes(me.id)) throw new HttpsError("not-found", "No Wheel of Doom here.");
    if (b.status !== "active") throw new HttpsError("failed-precondition", "That battle isn't running.");
    if ((b.dooms || {})[me.id]) throw new HttpsError("failed-precondition", "You already spun. No re-spins!");
    const spins = G.doomSpin(Math.random);
    t.update(ref, { [`dooms.${me.id}`]: spins });
    return { spins };
  });
});

// Room Rush: after the countdown, a player turns in how many things they cleaned up.
exports.rushCount = onCall(async (req) => {
  const cfg = await getConfig();
  const me = await actor(req, cfg);
  const id = String((req.data && req.data.id) || "");
  const count = Number(req.data && req.data.count);
  if (!Number.isInteger(count) || count < 0 || count > G.MAX_RUSH_ITEMS) throw new HttpsError("invalid-argument", `Enter a number from 0 to ${G.MAX_RUSH_ITEMS}.`);
  const ref = db.doc(`battles/${id}`);
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    const b = s.exists ? s.data() : null;
    if (!b || b.mode !== "roomrush" || !b.players.includes(me.id)) throw new HttpsError("not-found", "No Room Rush here.");
    if (b.status !== "active") throw new HttpsError("failed-precondition", "That battle isn't running.");
    const at = (b.attempts || {})[me.id];
    if (!at) throw new HttpsError("failed-precondition", "Start your timer first.");
    if (at.count != null) throw new HttpsError("failed-precondition", "You already turned in your count.");
    if (Date.now() < at.startAt + b.params.minutes * 60000 - 3000) throw new HttpsError("failed-precondition", "Keep going! Time isn't up yet.");
    const h = (b.handicap || {})[me.id] || 1;
    b.attempts = { ...b.attempts, [me.id]: { ...at, count, doneAt: Date.now() } };
    const u = { [`attempts.${me.id}`]: b.attempts[me.id], [`scores.${me.id}`]: { raw: count, adj: Math.round(count * h * 100) / 100 } };
    const result = G.decide(b, {}, cfg.chores, false);
    if (result) Object.assign(u, settle(b, result));
    t.update(ref, u);
  });
  await afterSettle(cfg, id);
  return { ok: true };
});

// A parent checks one Time Trial or Ghost Race run: was the chore done well?
// Once every finished run is checked, the fastest run done well wins.
exports.checkRun = onCall(async (req) => {
  if (!isParentAuth(req.auth)) throw new HttpsError("permission-denied", "Only a parent can check the work.");
  const cfg = await getConfig();
  const id = String((req.data && req.data.id) || "");
  const player = String((req.data && req.data.player) || "");
  const ok = !!(req.data && req.data.ok);
  const ref = db.doc(`battles/${id}`);
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new HttpsError("not-found", "That battle is gone.");
    const b = s.data();
    if (!G.TIMED.includes(b.mode) || !["active", "confirming"].includes(b.status)) throw new HttpsError("failed-precondition", "There's nothing to check here.");
    const a = (b.attempts || {})[player];
    if (!a || a.ms == null || a.void) throw new HttpsError("failed-precondition", "That run isn't finished.");
    const by = req.auth.token.name || req.auth.token.email;
    b.quality = { ...(b.quality || {}), [player]: ok };
    b.checkedBy = by;
    const u = { [`quality.${player}`]: ok, checkedBy: by };
    if (b.status === "confirming") {
      const r = qualityResult(b);
      if (r) Object.assign(u, { status: "done", result: { ...r, decidedAt: (b.result && b.result.decidedAt) || Date.now(), confirmedBy: by, confirmedAt: Date.now() } });
    }
    t.update(ref, u);
  });
  if (!ok) await pushTo([player], "🔁 Not quite done right", "A parent checked your timed run. It doesn't count this time, so give that chore another look.");
  await afterSettle(cfg, id);
  return { ok: true };
});

// A parent picks the winner of a Judge's Pick battle (or calls it a tie).
exports.judgeBattle = onCall(async (req) => {
  if (!isParentAuth(req.auth)) throw new HttpsError("permission-denied", "Only a parent can judge.");
  const cfg = await getConfig();
  const id = String((req.data && req.data.id) || "");
  const pick = String((req.data && req.data.winner) || "");
  const ref = db.doc(`battles/${id}`);
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new HttpsError("not-found", "That battle is gone.");
    const b = s.data();
    if (b.status !== "judging") throw new HttpsError("failed-precondition", "That battle isn't waiting for a judge.");
    if (pick !== "tie" && !b.players.includes(pick)) throw new HttpsError("invalid-argument", "Pick one of the players.");
    const by = req.auth.token.name || req.auth.token.email;
    t.update(ref, { status: "done", result: { ...(b.result || {}), needsParent: false, winner: pick === "tie" ? null : pick, tie: pick === "tie", reason: pick === "tie" ? "The judge called it a tie" : "The judge's pick", confirmedBy: by, confirmedAt: Date.now() } });
  });
  await afterSettle(cfg, id);
  return { ok: true };
});

// Status changes once a result is decided. No-contest battles, co-op raids, and
// daily-checked modes end right away; speed results wait for a confirmation.
function settle(b, result) {
  const now = Date.now();
  if (result.noContest || !SPEED.includes(b.mode)) return { status: "done", result: { ...result, decidedAt: now } };
  // Timed runs are only a pending result until a parent checks the work was done well.
  if (G.TIMED.includes(b.mode)) {
    const done = qualityResult(b);
    if (done) return { status: "done", result: { ...done, decidedAt: now, confirmedBy: b.checkedBy || "parent", confirmedAt: now } };
    return { status: "confirming", result: { ...result, decidedAt: now, needsParent: true, qualityCheck: true } };
  }
  return { status: "confirming", result: { ...result, decidedAt: now, needsParent: false } };
}
// The final result of a timed battle once a parent has checked every finished run, or null.
// Runs that didn't pass count as not finished, so the fastest run done well wins.
function qualityResult(b) {
  const q = b.quality || {};
  const finished = b.players.filter((p) => { const a = (b.attempts || {})[p]; return a && a.ms != null && !a.void; });
  if (finished.some((p) => q[p] == null)) return null;
  const attempts = { ...(b.attempts || {}) };
  for (const p of finished) if (!q[p]) attempts[p] = { ...attempts[p], void: "Didn't pass the parent's check" };
  const r = G.decide({ ...b, attempts }, {}, [], true);
  if (r && r.noContest && finished.length) return { ...r, reason: "No run passed the parent's check" };
  if (r && !r.noContest && finished.some((p) => !q[p])) return { ...r, reason: b.mode === "ghost" ? r.reason : "Fastest run done well" };
  return r;
}
// Pays XP for a finished battle (idempotent), then takes it off the live list.
async function afterSettle(cfg, id) {
  const ref = db.doc(`battles/${id}`);
  const s = await ref.get();
  if (!s.exists) return;
  const b = s.data();
  if (b.status === "confirming" && b.live && !b.notified) {
    await ref.update({ notified: true });
    if (b.result && b.result.qualityCheck) await pushTo(b.players, "⏳ Time's in!", "A parent will check the work, then the winner is final.");
    else await pushTo(b.players, "⚔️ Battle over!", "Open Boon Chores to see who won.");
    if (b.result && b.result.qualityCheck) await pushParents("⏱️ Check the work", `${b.players.map((p) => personName(cfg, p)).join(" and ")} finished a timed run. Check it was done well in the Game tab.`);
    else if (b.result && b.result.needsParent) await pushParents("⚔️ A battle needs a parent", "A result needs checking in the Game tab.");
  }
  if (b.status !== "done" || !b.live) return;
  const mode = G.modeById(b.mode);
  const xp = G.battleXp(b, b.result);
  const r = b.result || {};
  const ages = Object.fromEntries(b.players.map((p) => [p, G.effAge(kidOf(cfg, p) || {}, G.gameCfg(cfg).battles.adultAge)]));
  for (const p of b.players) {
    const won = G.isWinner(b, r, p);
    const count = [r.tie ? "tie" : won ? "win" : "loss"];
    if (won && !b.teams && b.players.length === 2) {
      const other = b.players.find((o) => o !== p);
      if (ages[p] < ages[other]) count.push("giant");
    }
    const label = r.record ? "record set" : r.tie ? "tie" : won ? (b.mode === "ghost" ? "new best" : G.isRaid(b.mode) ? "boss beaten" : "won") : "played";
    const pbMs = b.mode === "ghost" && won && b.attempts[p] ? b.attempts[p].ms : null;
    await applyXp(p, xp[p] ? [{ key: "battle:" + id, amount: xp[p], reason: `${mode ? mode.name : "Battle"}: ${label}`, count }] : [],
      [], pbMs != null ? (x) => { x.pb = { ...(x.pb || {}), [b.params.choreId]: pbMs }; return true; } : null);
    await syncBadges(cfg, p);
    await evalQuests(cfg, p);
  }
  if (G.isRaid(b.mode) && r.winnerSide) {
    await db.runTransaction(async (t) => {
      const cur = await t.get(ref);
      if (cur.data().bossCounted) return;
      t.set(db.doc("xp/_family"), { [b.mode === "babyraid" ? "babyBossesBeaten" : "bossesBeaten"]: FieldValue.increment(1) }, { merge: true });
      t.update(ref, { bossCounted: true });
    });
  }
  await ref.update({ live: false, xp });
  for (const p of b.players) {
    const [title, body] = resultPush(cfg, b, p, xp[p]);
    await pushTo([p], title, body);
  }
  const names = b.players.map((p) => personName(cfg, p)).join(" vs ");
  const [ft] = resultPush(cfg, b, null, 0);
  await pushBattleFeed(`${mode.emoji} ${mode.name} over: ${names}`, ft.replace(/^\S+\s/, ""), b.players);
}

// Recomputes live scores for chore-scored battles after a chore is logged or reversed.
async function updateBattlesFor(cfg, personId) {
  const snap = await db.collection("battles").where("live", "==", true).get();
  for (const d of snap.docs) {
    const b = d.data();
    if (b.status !== "active" || !b.players.includes(personId) || !LIVE_SCORED.includes(b.mode)) continue;
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
    let result = null;
    if (b.mode === "streakduel") result = await duelCheck(cfg, b, now, u);
    else if (b.mode === "showdown") result = await showdownCheck(cfg, b, now, u);
    else {
      const entriesBy = LIVE_SCORED.includes(b.mode) ? await battleEntries(cfg, b) : {};
      // Territory: a claim whose chore a parent reversed goes back to neutral.
      if (G.isMapTerritory(b)) for (const k of G.reversedLand(b, entriesBy)) { u[`land.${k}`] = FieldValue.delete(); delete b.land[k]; }
      if (LIVE_SCORED.includes(b.mode)) {
        u.scores = b.scores = G.battleScores(b, entriesBy, cfg.chores);
        if (b.teams) u.teamScores = G.teamScores(b, entriesBy, cfg.chores);
      }
      result = G.decide(b, entriesBy, cfg.chores, now >= b.endAt);
      if (!result && b.mode === "judge" && now >= b.endAt && b.players.every((p) => (b.attempts || {})[p] && b.attempts[p].entryId)) {
        u.status = "judging";
        u.result = { decidedAt: now, needsParent: true, reason: "Waiting for a parent to judge" };
      }
    }
    if (result) Object.assign(u, settle(b, result));
    if (Object.keys(u).length) t.update(ref, u);
  });
  await afterSettle(cfg, id);
}

// Streak Duel: checks each finished day. First to miss their daily list loses; both missing is a tie.
async function duelCheck(cfg, b, now, u) {
  const today = localParts(tzOf(cfg), new Date(now)).date;
  const prIds = prIdsOf(cfg);
  const snaps = await db.getAll(...b.players.map((p) => db.doc(`prefs/${p}`)));
  const prefs = Object.fromEntries(snaps.map((s, i) => [b.players[i], s.exists ? s.data() : {}]));
  const ok = (p, d) => G.dayComplete(prefs[p].prLog, prIds, d, doneDates(prefs[p]));
  let d = b.checkedThrough ? addDays(b.checkedThrough, 1) : b.params.startDate;
  let last = b.checkedThrough || null;
  const days = { ...(b.duelDays || {}) };
  while (d < today && d <= b.params.endDate) {
    const [a, c] = b.players;
    const oa = ok(a, d), oc = ok(c, d);
    days[d] = { [a]: oa, [c]: oc };
    last = d;
    u.checkedThrough = last;
    u.duelDays = days;
    const n = Object.keys(days).length;
    if (!oa && !oc) return { tie: true, reason: `Both missed on day ${n}` };
    if (!oa || !oc) return { winner: oa ? a : c, reason: `${personName(cfg, oa ? c : a)} missed day ${n}` };
    if (d === b.params.endDate) return { tie: true, reason: "Nobody missed a day in 14 days!" };
    d = addDays(d, 1);
  }
  return null;
}

// Goal Showdown: decided once both players' week is cashed out, or two days after the week ends.
async function showdownCheck(cfg, b, now, u) {
  const wk = b.params.week;
  const today = localParts(tzOf(cfg), new Date(now)).date;
  const refs = [];
  for (const p of b.players) for (let i = 0; i <= 4; i++) refs.push(db.doc(`weeks/${addDays(wk, -7 * i)}_${p}`));
  const snaps = await db.getAll(...refs);
  const byId = Object.fromEntries(snaps.map((s) => [s.id, s.exists ? s.data() : null]));
  const net = (w) => {
    if (!w) return 0;
    if (w.cashout && w.cashout.net != null) return w.cashout.net;
    let n = 0;
    for (const e of w.entries || []) if (e.status !== "reversed") n += e.amount || 0;
    for (const d of w.deductions || []) if (d.status === "active" || d.status === "final") n -= d.amount || 0;
    return Math.round(n * 100) / 100;
  };
  const cur = (p) => byId[`${wk}_${p}`];
  const closed = b.players.every((p) => cur(p) && cur(p).closed);
  if (!closed && today < addDays(wk, 8)) return null;
  const scores = {};
  for (const p of b.players) {
    const past = [1, 2, 3, 4].map((i) => byId[`${addDays(wk, -7 * i)}_${p}`]).filter(Boolean);
    const avg = past.length ? past.reduce((s, w) => s + net(w), 0) / past.length : 0;
    const w = cur(p);
    const sc = G.showdownScore(net(w), w && w.goal, avg);
    scores[p] = { raw: Math.round(sc * 100), adj: Math.round(sc * 100) };
  }
  u.scores = scores;
  const [a, c] = b.players;
  if (!scores[a].raw && !scores[c].raw) return { noContest: true, reason: "Nobody earned anything that week" };
  if (scores[a].adj === scores[c].adj) return { tie: true, reason: `Both reached ${scores[a].adj}% of their goal` };
  const w = scores[a].adj > scores[c].adj ? a : c;
  return { winner: w, reason: `${personName(cfg, w)} reached ${scores[w].adj}% of their goal` };
}

exports.confirmResult = onCall(async (req) => {
  const cfg = await getConfig();
  const id = String((req.data && req.data.id) || "");
  const action = String((req.data && req.data.action) || "confirm");
  const ref = db.doc(`battles/${id}`);
  const parentMode = isParentAuth(req.auth) && !(req.data && req.data.as);
  const me = parentMode ? null : await actor(req, cfg);
  let disputed = false;
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new HttpsError("not-found", "That battle is gone.");
    const b = s.data();
    const r = b.result || {};
    const now = Date.now();
    if (parentMode) {
      if (!["confirming", "judging"].includes(b.status)) throw new HttpsError("failed-precondition", "That result is already settled.");
        const by = req.auth.token.name || req.auth.token.email;
      if (action === "void") t.update(ref, { status: "done", result: { ...r, winner: null, winnerSide: null, tie: false, noContest: true, reason: "Called off by a parent", confirmedBy: by, confirmedAt: now } });
      else if (action === "confirm" && G.TIMED.includes(b.mode)) throw new HttpsError("failed-precondition", "Check each run as done well or not instead.");
      else if (action === "confirm" && b.status === "confirming") t.update(ref, { status: "done", result: { ...r, confirmedBy: by, confirmedAt: now } });
      else throw new HttpsError("invalid-argument", "Unknown action.");
      return;
    }
    if (b.status !== "confirming") throw new HttpsError("failed-precondition", "That result is already settled.");
    if (!b.players.includes(me.id) || b.players.length < 2) throw new HttpsError("permission-denied", "A parent has to check this one.");
    if (G.isWinner(b, r, me.id)) throw new HttpsError("permission-denied", "The other player or a parent has to confirm your win.");
    if (action === "dispute") {
      t.update(ref, { result: { ...r, needsParent: true, disputedBy: me.id, disputedAt: now } });
      disputed = true;
    } else if (action === "confirm") {
      if (r.needsParent) throw new HttpsError("failed-precondition", "A parent has to check this one.");
      t.update(ref, { status: "done", result: { ...r, confirmedBy: me.id, confirmedAt: now } });
    } else throw new HttpsError("invalid-argument", "Unknown action.");
  });
  if (disputed) await pushParents("⚔️ A battle result was disputed", `${personName(cfg, me.id)} asked a parent to check. See the Game tab.`);
  await afterSettle(cfg, id);
  return { ok: true };
});

// Every 5 minutes: expire old challenges, end timed-out battles, check daily modes, auto-confirm results.
async function runBattleTick(now = Date.now()) {
  const cfg = await getConfig();
  if (!cfg) return;
  const snap = await db.collection("battles").where("live", "==", true).get();
  for (const d of snap.docs) {
    const b = d.data();
    try {
      if (b.status === "pending" && now - b.createdAt > MS_PENDING) {
        await d.ref.update({ status: "expired", live: false });
        const others = b.players.filter((p) => p !== b.challenger && !(b.accepted || {})[p]);
        await pushTo([b.challenger], "⏰ Challenge expired", `${others.map((p) => personName(cfg, p)).join(" and ")} didn't answer in time.`);
      } else if (b.status === "active") {
        await refreshBattle(cfg, d.id, now);
      } else if (b.status === "confirming" || b.status === "judging") {
        const age = now - ((b.result && b.result.decidedAt) || b.createdAt);
        const r = b.result || {};
        if (b.status === "confirming" && !r.needsParent && age >= MS_AUTOCONFIRM) {
          await d.ref.update({ status: "done", result: { ...r, confirmedBy: "auto", confirmedAt: now } });
        } else if (r.needsParent && age >= MS_PARENT_WAIT) {
          await d.ref.update({ status: "done", result: { ...r, winner: null, winnerSide: null, tie: false, noContest: true, reason: "No parent checked it in time" } });
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

/* ---------- weekly quests ---------- */

// Awards any quests this person has finished this week. Progress is computed from the week's records.
async function evalQuests(cfg, personId) {
  if (!G.gameCfg(cfg).quests.enabled) return;
  const L = localParts(tzOf(cfg));
  const mon = mondayOf(L.date, L.dow), sun = addDays(mon, 6), fri = addDays(mon, 4);
  const [w1, w2, p] = await db.getAll(db.doc(`weeks/${mon}_${personId}`), db.doc(`weeks/${addDays(mon, 7)}_${personId}`), db.doc(`prefs/${personId}`));
  const tz = tzOf(cfg);
  const all = [w1, w2].flatMap((s) => (s.exists ? s.data().entries || [] : []));
  const entries = all.filter((e) => e.status !== "reversed" && e.date >= mon && e.date <= sun).map((e) => ({ ...e, hour: hourIn(tz, e.t) }));
  const week = w1.exists ? w1.data() : {};
  const prefs = p.exists ? p.data() : {};
  const prIds = prIdsOf(cfg);
  let checklistDays = 0;
  for (let i = 0; i < 7; i++) if (G.dayComplete(prefs.prLog, prIds, addDays(mon, i), doneDates(prefs))) checklistDays++;
  const byFri = entries.filter((e) => e.date <= fri).reduce((s, e) => s + (e.amount || 0), 0) -
    (week.deductions || []).filter((d) => d.status === "active" || d.status === "final").reduce((s, d) => s + (d.amount || 0), 0);
  const battles = (await db.collection("battles").where("day", ">=", mon).get()).docs.map((d) => d.data());
  const wins = battles.filter((b) => b.status === "done" && b.day <= sun && b.players.includes(personId) && G.isWinner(b, b.result, personId)).length;
  const ctx = { entries, chores: cfg.chores, cotdOf: (date) => G.choreOfDay(cfg.chores, date, cfg), checklistDays, wins, goal: week.goal || 0, netByFri: byFri };
  const done = G.questStatus(mon, personId, ctx).filter((q) => q.done);
  await applyXp(personId, done.map((q) => ({ key: `quest:${mon}:${q.id}`, amount: q.xp, reason: `Quest: ${q.text}`, count: ["quest"] })));
}

/* ---------- rewards and bounties ---------- */

// A person claims a reward they've reached. A parent approves it in the Game tab.
exports.claimReward = onCall(async (req) => {
  const cfg = await getConfig();
  const me = await actor(req, cfg);
  const rewardId = String((req.data && req.data.rewardId) || "");
  const reward = G.gameCfg(cfg).rewards.find((r) => r.id === rewardId);
  if (!reward) throw new HttpsError("not-found", "That reward is gone.");
  const xs = await db.doc(`xp/${me.id}`).get();
  const level = (xs.exists && xs.data().maxLevel) || 1;
  const mine = (await db.collection("claims").where("personId", "==", me.id).get()).docs.map((d) => d.data()).filter((c) => c.rewardId === rewardId);
  const slot = G.nextRewardSlot(reward, level, mine.map((c) => c.slot));
  if (slot == null) throw new HttpsError("failed-precondition", level < reward.level ? `Reach level ${reward.level} first.` : "You've already claimed this one.");
  const ref = db.doc(`claims/${me.id}_${rewardId}_${slot}`);
  try {
    await ref.create({ personId: me.id, rewardId, name: reward.name, slot, status: "pending", createdAt: Date.now() });
  } catch (e) {
    throw new HttpsError("already-exists", "You've already claimed this one.");
  }
  await pushParents(`🎁 ${personName(cfg, me.id)} claimed a reward`, `${reward.name}. Approve it in the Game tab.`);
  return { ok: true, slot };
});

// A kid says they finished a parent's bounty.
exports.claimBounty = onCall(async (req) => {
  const cfg = await getConfig();
  const me = await actor(req, cfg);
  const ref = db.doc(`bounties/${String((req.data && req.data.id) || "")}`);
  const b = await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new HttpsError("not-found", "That bounty is gone.");
    const b = s.data();
    if (b.status !== "open") throw new HttpsError("failed-precondition", b.status === "claimed" ? "Someone already said they did it." : "That bounty is closed.");
    if (b.for && b.for !== me.id) throw new HttpsError("permission-denied", "That bounty is for someone else.");
    t.update(ref, { status: "claimed", claimedBy: me.id, claimedAt: Date.now() });
    return b;
  });
  await pushParents(`🏅 ${personName(cfg, me.id)} finished a bounty`, `"${b.name}". Check it in the Game tab.`);
  return { ok: true };
});

// A parent marks a bounty done for someone, which pays its XP.
exports.awardBounty = onCall(async (req) => {
  if (!isParentAuth(req.auth)) throw new HttpsError("permission-denied", "Parents only.");
  const cfg = await getConfig();
  const id = String((req.data && req.data.id) || "");
  const personId = String((req.data && req.data.personId) || "");
  if (!kidOf(cfg, personId)) throw new HttpsError("invalid-argument", "Pick who did it.");
  const ref = db.doc(`bounties/${id}`);
  const b = await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new HttpsError("not-found", "That bounty is gone.");
    const b = s.data();
    if (b.status === "done" || b.status === "cancelled") throw new HttpsError("failed-precondition", "That bounty is closed.");
    t.update(ref, { status: "done", doneBy: personId, doneAt: Date.now(), awardedBy: req.auth.token.name || req.auth.token.email });
    return b;
  });
  const amount = Math.max(1, Math.min(1000, Math.round(Number(b.xp) || 0)));
  await applyXp(personId, [{ key: "bounty:" + id, amount, reason: "Bounty: " + b.name, count: ["bounty"] }]);
  await pushTo([personId], "🏅 Bounty done!", `+${amount} XP for "${b.name}".`);
  return { ok: true };
});

// Emulator-only hooks so tests can run scheduled jobs at a chosen time. Never deployed.
if (process.env.FUNCTIONS_EMULATOR === "true") {
  exports.testHooks = onCall(async (req) => {
    const what = req.data && req.data.run;
    if (what === "tick") await runBattleTick(Number(req.data.now) || Date.now());
    else if (what === "freezes") await runFreezes();
    else if (what === "quests") await evalQuests(await getConfig(), String(req.data.person));
    return { ok: true };
  });
}
