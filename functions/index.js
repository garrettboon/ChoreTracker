"use strict";
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineString } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const crypto = require("crypto");

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
  return db.runTransaction(async (t) => {
    const cfg = (await t.get(db.doc("app/config"))).data();
    const kid = cfg && cfg.kids.find((k) => k.id === kidId);
    const ch = cfg && cfg.chores.find((c) => c.id === choreId && c.kind === "family");
    if (!kid || !ch) throw new HttpsError("invalid-argument", "Unknown chore.");
    if (!by && !kid.adult && needsNote(ch) && !note) throw new HttpsError("invalid-argument", "Say what the chore was first.");
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
    if (note) entry.detail = note;
    t.set(db.doc(`weeks/${wk}_${kidId}`), { kidId, week: wk, entries: FieldValue.arrayUnion(entry) }, { merge: true });
    return { amount, week: wk };
  });
});

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

    const res = await getMessaging().sendEachForMulticast({
      tokens: targets.map((d) => d.data().fcmToken),
      notification: { title: `${kid.name}, still to do today`, body: todo.join(", ") },
    });
    await Promise.all(res.responses.map((r, i) => {
      const code = r.error && r.error.code;
      if (!r.success && (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token")) {
        return targets[i].ref.update({ fcmToken: FieldValue.delete() });
      }
      return null;
    }));
  }
});
