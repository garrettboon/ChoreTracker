// Shared setup for tests that run against the Firebase emulators (npm run test:emulators).
import { initializeApp as adminInit, getApps } from "firebase-admin/app";
import { getFirestore as adminFirestore } from "firebase-admin/firestore";
import { getAuth as adminAuthOf } from "firebase-admin/auth";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInAnonymously, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, terminate } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "firebase/functions";

export const PROJECT = "demo-boon";
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";
const adminApp = getApps()[0] || adminInit({ projectId: PROJECT });
export const db = adminFirestore(adminApp);
export const adminAuth = adminAuthOf(adminApp);

export const CONFIG = {
  timezone: "America/Denver",
  split: { spend: 50, save: 25, invest: 15, give: 10 },
  interest: { low: 10, threshold: 100, high: 5 },
  kids: [
    { id: "dad", name: "Dad", age: 0, adult: true, rate: 0.5, remind: [], email: "dad@test.com" },
    { id: "k1", name: "Teslyn", age: 12, rate: 0.5, remind: [] },
    { id: "k2", name: "Warren", age: 10, rate: 0.25, remind: [] },
    { id: "k3", name: "Maggie", age: 8, rate: 0.25, remind: [] },
  ],
  chores: [
    { id: "c1", kind: "family", name: "Sweep", mult: 1, limit: 20, assign: "pool" },
    { id: "c2", kind: "family", name: "Dishes", mult: 1, limit: 20, assign: "pool" },
    { id: "big", kind: "family", name: "Bathroom", mult: 2, limit: 20, assign: "pool" },
    { id: "mine", kind: "family", name: "Feed dog", mult: 1, limit: 5, assign: "k1" },
    { id: "p1", kind: "pr", name: "Morning routine", note: "" },
    { id: "p2", kind: "pr", name: "Teeth", note: "" },
  ],
  // Deterministic XP in tests: no chore of the day or quests, battles allowed at any hour.
  game: { choreOfDay: { enabled: false }, quests: { enabled: false }, battles: { quietStart: "00:00", quietEnd: "00:00" } },
};

const clients = [];
export async function reset(config = CONFIG) {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await db.doc("app/config").set(config);
  await db.doc("app/family").set({ parentEmails: ["parent@test.com", "dad@test.com"] });
}

let n = 0;
async function client() {
  const app = initializeApp({ projectId: PROJECT, apiKey: "demo-key", authDomain: "demo-boon.firebaseapp.com" }, "c" + n++);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const fdb = getFirestore(app);
  connectFirestoreEmulator(fdb, "127.0.0.1", 8080);
  const fns = getFunctions(app);
  connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  const c = { app, auth, db: fdb, call: (name, data) => httpsCallable(fns, name, { timeout: 120000 })(data).then((r) => r.data) };
  clients.push(c);
  return c;
}
export async function kidClient(kidId) {
  const c = await client();
  const u = await signInAnonymously(c.auth);
  await db.doc(`devices/${u.user.uid}`).set({ role: "kid", kidId, name: "test tablet" });
  return c;
}
export async function parentClient(email = "parent@test.com") {
  const c = await client();
  await adminAuth.createUser({ email, password: "secret123", emailVerified: true, displayName: email.split("@")[0] }).catch(() => {});
  await signInWithEmailAndPassword(c.auth, email, "secret123");
  return c;
}
export async function closeAll() {
  for (const c of clients.splice(0)) { await terminate(c.db).catch(() => {}); await deleteApp(c.app).catch(() => {}); }
}

export async function waitFor(fn, { timeout = 20000, interval = 200, msg = "" } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = String(e); }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for ${msg}. Last value: ${JSON.stringify(last)}`);
}
// Waits until background triggers stop changing a document.
export async function quiet(path, ms = 1500) {
  let prev = null, stableSince = Date.now();
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const s = await db.doc(path).get();
    const cur = JSON.stringify(s.exists ? s.data() : null);
    if (cur !== prev) { prev = cur; stableSince = Date.now(); }
    else if (Date.now() - stableSince >= ms) return s.exists ? s.data() : null;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Document never settled: " + path);
}
export const xpOf = async (id) => { const s = await db.doc(`xp/${id}`).get(); return s.exists ? s.data() : null; };
export const eventKeys = async (id) => (await db.collection(`xp/${id}/events`).get()).docs.map((d) => d.id).sort();
export const battle = async (id) => (await db.doc(`battles/${id}`).get()).data();

// Today's date in the family's time zone, as the functions see it.
export function today(offsetDays = 0) {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + offsetDays)).toISOString().slice(0, 10);
}
export async function rejects(promise, re) {
  try { await promise; } catch (e) { if (re && !re.test(e.message)) throw new Error(`Wrong error: ${e.message}`); return e; }
  throw new Error("Expected an error");
}
