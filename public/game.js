// Boon Bank game rules: XP, levels, unlocks, streaks, badges, and battles.
// Pure functions only. The browser imports this file directly; Cloud Functions
// load an identical copy at functions/game.mjs (run `npm run sync` after editing).

/* ---------- dates (YYYY-MM-DD strings) ---------- */
export function addDays(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/* ---------- levels ---------- */
export const MAX_LEVEL = 30;
export const xpToNext = (level) => Math.round(60 * Math.pow(level, 1.3));
export function levelStart(level) { let s = 0; for (let i = 1; i < level; i++) s += xpToNext(i); return s; }
export function levelFor(total) {
  let level = 1, start = 0;
  while (level < MAX_LEVEL && total >= start + xpToNext(level)) { start += xpToNext(level); level++; }
  return level;
}
export function levelProgress(total) {
  const level = levelFor(total), start = levelStart(level);
  const need = level >= MAX_LEVEL ? 0 : xpToNext(level);
  return { level, into: total - start, need, frac: need ? (total - start) / need : 1 };
}

/* ---------- XP values ---------- */
export const XP = {
  chore: 10, checklist: 5, goal: 50, redeem: 20, savingsGoal: 50, badge: 25,
  win: 40, tie: 25, loss: 15, ghostRecord: 25,
};
export const STREAK_MILESTONES = { 3: 25, 7: 50, 14: 75, 30: 150, 60: 250, 100: 400 };
export const FREEZE_CAP = 2;
export const freezeLevels = (from, to) => { let n = 0; for (let l = from + 1; l <= to; l++) if (l % 5 === 0) n++; return n; };

/* ---------- settings (parent-editable, merged over defaults) ---------- */
export const GAME_DEFAULTS = {
  choreOfDay: { enabled: true, pin: null },
  streakMultiplier: { enabled: true, minStreak: 7, mult: 1.25 },
  battles: {
    enabled: true, modesOff: [], quietStart: "20:30", quietEnd: "07:00", dailyCap: 3,
    handicapPerYear: 0.08, handicapMax: 1.5, adultAge: 18,
  },
};
export function gameCfg(config) {
  const g = (config && config.game) || {};
  return {
    choreOfDay: { ...GAME_DEFAULTS.choreOfDay, ...(g.choreOfDay || {}) },
    streakMultiplier: { ...GAME_DEFAULTS.streakMultiplier, ...(g.streakMultiplier || {}) },
    battles: { ...GAME_DEFAULTS.battles, ...(g.battles || {}) },
  };
}

/* ---------- unlockables ---------- */
// [id, emoji, name, level]. Level 1 creatures are the free starters.
export const CREATURES = [
  ["dragon", "🐉", "Dragon", 1], ["fox", "🦊", "Fox", 1], ["frog", "🐸", "Frog", 1], ["dino", "🦖", "T. rex", 1],
  ["unicorn", "🦄", "Unicorn", 1], ["octopus", "🐙", "Octopus", 1], ["shark", "🦈", "Shark", 1], ["turtle", "🐢", "Turtle", 1],
  ["owl", "🦉", "Owl", 1], ["bee", "🐝", "Bee", 1], ["tiger", "🐯", "Tiger", 1], ["penguin", "🐧", "Penguin", 1],
  ["hedgehog", "🦔", "Hedgehog", 2], ["sloth", "🦥", "Sloth", 3], ["wolf", "🐺", "Wolf", 4], ["lion", "🦁", "Lion", 6],
  ["panda", "🐼", "Panda", 7], ["flamingo", "🦩", "Flamingo", 9], ["whale", "🐳", "Whale", 11], ["eagle", "🦅", "Eagle", 13],
  ["robot", "🤖", "Robot", 14], ["invader", "👾", "Space Invader", 16], ["wizard", "🧙", "Wizard", 18],
  ["elder", "🐲", "Elder Dragon", 20], ["hero", "🦸", "Hero", 25], ["peacock", "🦚", "Peacock", 30],
];
export const STARTERS = CREATURES.filter((c) => c[3] === 1).map((c) => c[0]);
export const HATS = [
  ["tophat", "🎩", "Top hat", 3], ["shades", "🕶️", "Shades", 5], ["bow", "🎀", "Bow", 6],
  ["cap", "🧢", "Cap", 8], ["crown", "👑", "Crown", 12], ["wand", "🪄", "Magic wand", 17],
];
export const THEMES = [["ocean", "Ocean", 4], ["forest", "Forest", 7], ["space", "Space", 10], ["candy", "Candy", 14], ["gold", "Gold", 22]];
export const TRAILS = [["rainbow", "Rainbow", 9], ["stars", "Starry night", 11], ["lava", "Lava", 16], ["ice", "Ice", 19]];
export const CONFETTI = [["stars", "Stars", 6], ["hearts", "Hearts", 9], ["coins", "Coins", 13]];
// Level titles, then achievement titles earned from counts on the xp doc.
export const TITLES = [
  ["rookie", "Rookie", 1], ["helper", "Helper", 3], ["hardworker", "Hard Worker", 5], ["champ", "Chore Champ", 8],
  ["super", "Super Helper", 10], ["hero", "Household Hero", 15], ["legend", "Legend", 20], ["mythic", "Mythic", 25],
  ["grandmaster", "Grandmaster", 30],
  ["comeback", "Comeback Kid", 0, (x) => (x.counts.redeem || 0) >= 1, "Earn back a deduction"],
  ["crusher", "Goal Crusher", 0, (x) => (x.counts.goal || 0) >= 5, "Hit 5 weekly goals"],
  ["machine", "Chore Machine", 0, (x) => (x.counts.chore || 0) >= 100, "Do 100 chores"],
  ["unstoppable", "Unstoppable", 0, (x) => (x.bestStreak || 0) >= 30, "30-day streak"],
  ["battlechamp", "Battle Champ", 0, (x) => (x.counts.win || 0) >= 10, "Win 10 battles"],
  ["giantslayer", "Giant Slayer", 0, (x) => (x.counts.giant || 0) >= 1, "Beat someone older in a battle"],
];
export const STAGES = [[1, "Hatchling"], [5, "Buddy"], [10, "Champion"], [20, "Legend"]];
export const stageFor = (level) => { let s = 1; STAGES.forEach(([l], i) => { if (level >= l) s = i + 1; }); return s; };

/* ---------- battle modes ---------- */
export const MODES = [
  { id: "race", emoji: "🏁", name: "Race", level: 1, desc: "First to finish the chores wins." },
  { id: "timetrial", emoji: "⏱️", name: "Time Trial", level: 1, desc: "Same chore, fastest time wins." },
  { id: "ghost", emoji: "👻", name: "Ghost Race", level: 1, solo: true, desc: "Beat your own best time on a chore." },
  { id: "blitz", emoji: "⚡", name: "Blitz", level: 3, desc: "Most chore XP before time runs out." },
  { id: "bingo", emoji: "🎱", name: "Chore Bingo", level: 5, soon: true, desc: "First to finish a row of chores." },
  { id: "territory", emoji: "🚩", name: "Territory", level: 6, soon: true, desc: "Claim the most shared chores today." },
  { id: "judge", emoji: "🧑‍⚖️", name: "Judge's Pick", level: 8, soon: true, desc: "A parent picks the better job." },
  { id: "streakduel", emoji: "🔥", name: "Streak Duel", level: 10, soon: true, desc: "Last one to keep their streak wins." },
  { id: "showdown", emoji: "🎯", name: "Goal Showdown", level: 12, soon: true, desc: "Best percent of weekly goal wins." },
  { id: "raid", emoji: "🐉", name: "Boss Raid", level: 15, soon: true, desc: "Team up to beat a boss." },
  { id: "grownups", emoji: "👨‍👧", name: "Kids vs. Grown-ups", level: 15, soon: true, desc: "Team battle against the adults." },
  { id: "wildcard", emoji: "🃏", name: "Wildcard", level: 20, soon: true, desc: "A random mode with a twist." },
];
export const modeById = (id) => MODES.find((m) => m.id === id);
export const TIMED = ["timetrial", "ghost"];
export const MIN_TRIAL_MS = 60 * 1000;      // faster than this always needs a parent
export const MAX_TRIAL_MS = 2 * 3600 * 1000; // longer than this voids the attempt

// Every unlock id a person has at a level, prefixed by kind:
// c: creature, h: hat, t: theme, r: trail, f: confetti, ti: title, m: battle mode.
export function unlockedIds(level, xpDoc) {
  const x = { counts: {}, bestStreak: 0, ...(xpDoc || {}) };
  x.counts = x.counts || {};
  const ids = [];
  for (const c of CREATURES) if (c[3] <= level) ids.push("c:" + c[0]);
  for (const h of HATS) if (h[3] <= level) ids.push("h:" + h[0]);
  for (const t of THEMES) if (t[2] <= level) ids.push("t:" + t[0]);
  for (const t of TRAILS) if (t[2] <= level) ids.push("r:" + t[0]);
  for (const t of CONFETTI) if (t[2] <= level) ids.push("f:" + t[0]);
  for (const t of TITLES) if (t[3] ? t[3](x) : t[2] <= level) ids.push("ti:" + t[0]);
  for (const m of MODES) if (!m.soon && m.level <= level) ids.push("m:" + m.id);
  return ids;
}
// Human-readable list of what a level-up unlocked.
export function describeUnlocks(ids) {
  const out = [];
  for (const id of ids) {
    const [k, v] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    const f = (list) => list.find((x) => x[0] === v);
    if (k === "c" && f(CREATURES)) out.push([f(CREATURES)[1], f(CREATURES)[2], "New creature"]);
    else if (k === "h" && f(HATS)) out.push([f(HATS)[1], f(HATS)[2], "New accessory"]);
    else if (k === "t" && f(THEMES)) out.push(["🎨", f(THEMES)[1], "New screen theme"]);
    else if (k === "r" && f(TRAILS)) out.push(["🛤️", f(TRAILS)[1], "New goal trail"]);
    else if (k === "f" && f(CONFETTI)) out.push(["🎉", f(CONFETTI)[1] + " confetti", "New celebration"]);
    else if (k === "ti" && f(TITLES)) out.push(["🏷️", f(TITLES)[1], "New title"]);
    else if (k === "m" && modeById(v)) out.push([modeById(v).emoji, modeById(v).name, "New battle mode"]);
  }
  return out;
}

/* ---------- daily checklist streaks ---------- */
export function dayComplete(prLog, prIds, date, frozen) {
  if (frozen && frozen.includes(date)) return true;
  if (!prIds.length) return false;
  const d = (prLog || {})[date] || [];
  return prIds.every((i) => d.includes(i));
}
// Consecutive complete days ending on `date`.
export function streakEnding(prLog, prIds, date, frozen) {
  let n = 0, d = date;
  while (n < 1000 && dayComplete(prLog, prIds, d, frozen)) { n++; d = addDays(d, -1); }
  return n;
}
// Current streak: today counts if done; otherwise the streak is still alive through yesterday.
export function streak(prLog, prIds, today, frozen) {
  return dayComplete(prLog, prIds, today, frozen) ? streakEnding(prLog, prIds, today, frozen)
    : streakEnding(prLog, prIds, addDays(today, -1), frozen);
}
export function bestStreak(prLog, prIds, frozen) {
  const dates = [...new Set([...Object.keys(prLog || {}), ...(frozen || [])])]
    .filter((d) => dayComplete(prLog, prIds, d, frozen)).sort();
  let best = 0, run = 0, prev = null;
  for (const d of dates) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}
// Every streak milestone reached in history, keyed by the run's first day so the same run never pays twice.
export function streakMilestones(prLog, prIds, frozen) {
  const dates = [...new Set([...Object.keys(prLog || {}), ...(frozen || [])])]
    .filter((d) => dayComplete(prLog, prIds, d, frozen)).sort();
  const out = [];
  let run = 0, start = null, prev = null;
  for (const d of dates) {
    if (prev && addDays(prev, 1) === d) run++; else { run = 1; start = d; }
    if (STREAK_MILESTONES[run]) out.push({ key: `streak${run}:${start}`, days: run, amount: STREAK_MILESTONES[run], date: d });
    prev = d;
  }
  return out;
}

/* ---------- chore XP ---------- */
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function choreOfDay(chores, date, config) {
  const g = gameCfg(config).choreOfDay;
  if (!g.enabled) return null;
  const fam = (chores || []).filter((c) => c.kind === "family");
  if (g.pin && g.pin.date === date && fam.some((c) => c.id === g.pin.choreId)) return g.pin.choreId;
  const pool = fam.filter((c) => c.assign === "pool");
  const list = (pool.length ? pool : fam).map((c) => c.id).sort();
  return list.length ? list[hash(date) % list.length] : null;
}
export const baseChoreXp = (ch) => Math.round(XP.chore * ((ch && ch.mult) || 1));
export function streakBoost(config, currentStreak) {
  const s = gameCfg(config).streakMultiplier;
  return s.enabled && currentStreak >= s.minStreak ? s.mult : 1;
}
export function choreXp(ch, { cotd = false, boost = 1 } = {}) {
  return Math.round(baseChoreXp(ch) * (cotd ? 2 : 1) * boost);
}

/* ---------- badges ---------- */
// s: { chores, goalHits, bestStreak, redemptions, saved, invest, give, bought, wins, giant }
export function badgeList(s) {
  return [
    ["first", "🧹", "First chore", s.chores >= 1],
    ["fifty", "💪", "50 chores", s.chores >= 50],
    ["goal1", "🎯", "Goal getter", s.goalHits >= 1],
    ["goal5", "🏆", "5 goals hit", s.goalHits >= 5],
    ["streak7", "🔥", "7-day streak", s.bestStreak >= 7],
    ["comeback", "🔁", "Comeback kid", s.redemptions >= 1],
    ["saved25", "🐷", "$25 saved", s.saved >= 25],
    ["invest100", "🌱", "$100 invested", s.invest >= 100],
    ["give10", "💝", "$10 given", s.give >= 10],
    ["bought", "🎁", "Bought a goal", s.bought >= 1],
    ["win1", "⚔️", "First victory", (s.wins || 0) >= 1],
    ["win10", "🥇", "10 wins", (s.wins || 0) >= 10],
    ["giant", "🗡️", "Giant slayer", (s.giant || 0) >= 1],
  ];
}

/* ---------- battles ---------- */
export const effAge = (p, adultAge = 18) => (p && p.adult ? adultAge : Number(p && p.age) || 0);
// Younger player's score multiplier; the older player is always 1.
export function handicaps(a, b, config) {
  const bc = gameCfg(config).battles;
  const aa = effAge(a, bc.adultAge), ab = effAge(b, bc.adultAge);
  const m = Math.min(1 + bc.handicapPerYear * Math.abs(aa - ab), bc.handicapMax);
  const r = Math.round(m * 100) / 100;
  return { [a.id]: aa < ab ? r : 1, [b.id]: ab < aa ? r : 1 };
}
export function inQuietHours(hm, config) {
  const { quietStart: s, quietEnd: e } = gameCfg(config).battles;
  if (!s || !e || s === e) return false;
  return s < e ? hm >= s && hm < e : hm >= s || hm < e;
}
// Chore entries that count for a battle: not reversed, done inside the window.
export function battleEntries(entries, startAt, endAt) {
  return (entries || []).filter((e) => e.status !== "reversed" && e.t >= startAt && e.t < endAt).sort((x, y) => x.t - y.t);
}
// Live scores. entriesBy: { personId: [entries] }. chores: config chores (for Blitz XP).
export function battleScores(b, entriesBy, chores) {
  const out = {};
  for (const p of b.players) {
    const list = battleEntries(entriesBy[p], b.startAt, b.endAt);
    let raw = 0;
    if (b.mode === "race") raw = list.length;
    else if (b.mode === "blitz") raw = list.reduce((s, e) => s + baseChoreXp((chores || []).find((c) => c.id === e.choreId)), 0);
    const h = (b.handicap && b.handicap[p]) || 1;
    out[p] = { raw, adj: Math.round(raw * h * 100) / 100 };
  }
  return out;
}
// Race: when each player crossed the finish line (adjusted), or null.
export function raceFinish(b, entriesBy) {
  const out = {};
  for (const p of b.players) {
    const h = (b.handicap && b.handicap[p]) || 1;
    const list = battleEntries(entriesBy[p], b.startAt, b.endAt);
    let n = 0; out[p] = null;
    for (const e of list) { n++; if (n * h >= b.params.n - 1e-9) { out[p] = e.t; break; } }
  }
  return out;
}
// Decide a battle. `final` means time is up. Returns null while still undecided, else
// { winner, tie, noContest, reason }.
export function decide(b, entriesBy, chores, final) {
  const [a, c] = b.players;
  if (b.mode === "race") {
    const f = raceFinish(b, entriesBy);
    const done = b.players.filter((p) => f[p] != null).sort((x, y) => f[x] - f[y]);
    if (done.length) return { winner: done[0], tie: false, reason: "Finished first" };
    if (!final) return null;
    const s = battleScores(b, entriesBy, chores);
    return compareScores(s, a, c, "Most chores when time ran out");
  }
  if (b.mode === "blitz") {
    if (!final) return null;
    return compareScores(battleScores(b, entriesBy, chores), a, c, "Most XP when time ran out");
  }
  if (b.mode === "timetrial") {
    const at = b.attempts || {};
    const fin = (p) => at[p] && at[p].ms != null && !at[p].void;
    const over = (p) => fin(p) || (at[p] && at[p].void);
    if (!final && !(over(a) && over(c))) return null;
    if (!fin(a) && !fin(c)) return { noContest: true, reason: "Nobody finished" };
    if (!fin(a) || !fin(c)) return { winner: fin(a) ? a : c, tie: false, reason: "Only one finished" };
    const ta = at[a].ms / ((b.handicap && b.handicap[a]) || 1), tc = at[c].ms / ((b.handicap && b.handicap[c]) || 1);
    if (Math.abs(ta - tc) < 1000) return { tie: true, reason: "Within a second" };
    return { winner: ta < tc ? a : c, tie: false, reason: "Faster time" };
  }
  if (b.mode === "ghost") {
    const at = (b.attempts || {})[a];
    const fin = at && at.ms != null && !at.void;
    if (!fin && !(final || (at && at.void))) return null;
    if (!fin) return { noContest: true, reason: "Didn't finish" };
    if (b.pb == null) return { winner: a, record: true, reason: "First record set" };
    return at.ms < b.pb ? { winner: a, reason: "New personal best" } : { winner: null, lost: true, reason: "Didn't beat your best" };
  }
  return final ? { noContest: true, reason: "Unknown mode" } : null;
}
function compareScores(s, a, c, reason) {
  if (!s[a].raw && !s[c].raw) return { noContest: true, reason: "Nobody did a chore" };
  if (s[a].adj === s[c].adj) return { tie: true, reason };
  return { winner: s[a].adj > s[c].adj ? a : c, tie: false, reason };
}
// XP each player earns for a finished battle (uses the scores stored on the battle).
// Nobody earns XP for a battle they didn't try.
export function battleXp(b, result) {
  const out = {};
  if (!result || result.noContest) return out;
  if (b.mode === "ghost") {
    const p = b.players[0];
    out[p] = result.record ? XP.ghostRecord : result.winner ? XP.win : XP.loss;
    return out;
  }
  const tried = (p) => {
    if (TIMED.includes(b.mode)) { const at = (b.attempts || {})[p]; return !!(at && at.ms != null && !at.void); }
    return ((b.scores && b.scores[p] && b.scores[p].raw) || 0) > 0;
  };
  for (const p of b.players) {
    if (result.tie) out[p] = tried(p) ? XP.tie : 0;
    else out[p] = p === result.winner ? XP.win : tried(p) ? XP.loss : 0;
  }
  return out;
}
