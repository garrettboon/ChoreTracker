// Boon Chore Tracker game rules: XP, levels, unlocks, streaks, badges, and battles.
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
  win: 40, tie: 25, loss: 15, ghostRecord: 25, raidWin: 50, babyRaidWin: 25,
};
export const STREAK_MILESTONES = { 3: 25, 7: 50, 14: 75, 30: 150, 60: 250, 100: 400 };
export const FREEZE_CAP = 2;
export const freezeLevels = (from, to) => { let n = 0; for (let l = from + 1; l <= to; l++) if (l % 5 === 0) n++; return n; };

/* ---------- settings (parent-editable, merged over defaults) ---------- */
export const GAME_DEFAULTS = {
  choreOfDay: { enabled: true, pin: null },
  rewards: [],                                             // [{ id, level, name, repeat }] repeat: every N levels, 0 = once
  moneyPerks: { enabled: false, everyLevels: 5, amount: 0.05 }, // suggested raises, applied by a parent
  quests: { enabled: true },
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
    rewards: Array.isArray(g.rewards) ? g.rewards : [],
    moneyPerks: { ...GAME_DEFAULTS.moneyPerks, ...(g.moneyPerks || {}) },
    quests: { ...GAME_DEFAULTS.quests, ...(g.quests || {}) },
  };
}

/* ---------- unlockables ---------- */
// [id, emoji, name, level]. Level 1 creatures are the free starters.
export const CREATURES = [
  ["dragon", "🐉", "Dragon", 1], ["fox", "🦊", "Fox", 1], ["frog", "🐸", "Frog", 1], ["dino", "🦖", "T. rex", 1],
  ["unicorn", "🦄", "Unicorn", 1], ["octopus", "🐙", "Octopus", 1], ["shark", "🦈", "Shark", 1], ["turtle", "🐢", "Turtle", 1],
  ["owl", "🦉", "Owl", 1], ["bee", "🐝", "Bee", 1], ["tiger", "🐯", "Tiger", 1], ["penguin", "🐧", "Penguin", 1],
  ["hedgehog", "🦔", "Hedgehog", 2], ["sloth", "🦥", "Sloth", 3], ["wolf", "🐺", "Wolf", 4], ["cat", "🐱", "Cat", 5], ["lion", "🦁", "Lion", 6],
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
  { id: "timetrial", emoji: "⏱️", name: "Time Trial", level: 1, desc: "Same chore. Fastest time done well wins." },
  { id: "ghost", emoji: "👻", name: "Ghost Race", level: 1, solo: true, desc: "Beat your own best time, done well." },
  { id: "blitz", emoji: "⚡", name: "Blitz", level: 3, desc: "Most chore XP before time runs out." },
  { id: "bingo", emoji: "🎱", name: "Chore Bingo", level: 5, desc: "First to finish a row of chores wins." },
  { id: "territory", emoji: "🚩", name: "Territory", level: 6, kidsOnly: true, desc: "Claim the most Anyone chores by midnight." },
  { id: "judge", emoji: "🧑‍⚖️", name: "Judge's Pick", level: 8, desc: "Same chore. A parent picks the better job." },
  { id: "streakduel", emoji: "🔥", name: "Streak Duel", level: 10, desc: "Whoever misses their daily list first loses." },
  { id: "showdown", emoji: "🎯", name: "Goal Showdown", level: 12, desc: "Best share of your weekly goal wins." },
  { id: "raid", emoji: "🐉", name: "Boss Raid", level: 15, team: true, desc: "Team up and beat a boss with chores." },
  { id: "babyraid", emoji: "🐣", name: "Baby Boss Raid", level: 1, team: true, baby: true, desc: "A tiny boss for today. Go solo or team up. Easy to beat." },
  { id: "grownups", emoji: "👨‍👧", name: "Kids vs. Grown-ups", level: 15, team: true, desc: "Kids team against the adults." },
  { id: "wildcard", emoji: "🃏", name: "Wildcard", level: 20, desc: "A random mode with a twist." },
];
export const modeById = (id) => MODES.find((m) => m.id === id);
export const TIMED = ["timetrial", "ghost"];
export const isRaid = (mode) => mode === "raid" || mode === "babyraid";
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
// s: { chores, goalHits, bestStreak, redemptions, saved, invest, give, bought, wins, giant,
//      level, quests, bounties, checklistDays }
// Each badge: [id, emoji, name, earned, how to earn it]. Ids never change: XP is paid once per id.
export function badgeList(s) {
  const n = (v) => Number(v) || 0;
  const b = (id, emoji, name, earned, how) => [id, emoji, name, !!earned, how];
  return [
    // Chores
    b("first", "🧹", "First chore", n(s.chores) >= 1, "Do your first chore"),
    b("chores10", "🧽", "10 chores", n(s.chores) >= 10, "Do 10 chores"),
    b("fifty", "💪", "50 chores", n(s.chores) >= 50, "Do 50 chores"),
    b("chores100", "🏅", "100 chores", n(s.chores) >= 100, "Do 100 chores"),
    b("chores250", "🦾", "250 chores", n(s.chores) >= 250, "Do 250 chores"),
    b("chores500", "🏰", "Chore legend", n(s.chores) >= 500, "Do 500 chores"),
    // Daily checklist
    b("streak3", "✨", "3-day streak", n(s.bestStreak) >= 3, "Finish your daily list 3 days in a row"),
    b("streak7", "🔥", "7-day streak", n(s.bestStreak) >= 7, "Finish your daily list 7 days in a row"),
    b("streak14", "⚡", "14-day streak", n(s.bestStreak) >= 14, "Finish your daily list 14 days in a row"),
    b("streak30", "🌋", "30-day streak", n(s.bestStreak) >= 30, "Finish your daily list 30 days in a row"),
    b("streak100", "💎", "100-day streak", n(s.bestStreak) >= 100, "Finish your daily list 100 days in a row"),
    b("tidy100", "📅", "100 tidy days", n(s.checklistDays) >= 100, "Finish your daily list on 100 days"),
    // Weekly goals
    b("goal1", "🎯", "Goal getter", n(s.goalHits) >= 1, "Reach a weekly goal"),
    b("goal5", "🏆", "5 goals hit", n(s.goalHits) >= 5, "Reach 5 weekly goals"),
    b("goal10", "🎖️", "10 goals hit", n(s.goalHits) >= 10, "Reach 10 weekly goals"),
    b("goal25", "🏵️", "25 goals hit", n(s.goalHits) >= 25, "Reach 25 weekly goals"),
    b("comeback", "🔁", "Comeback kid", n(s.redemptions) >= 1, "Earn back a deduction"),
    b("comeback5", "🔄", "Never give up", n(s.redemptions) >= 5, "Earn back 5 deductions"),
    // Money
    b("saved10", "🪙", "$10 saved", n(s.saved) >= 10, "Save $10"),
    b("saved25", "🐷", "$25 saved", n(s.saved) >= 25, "Save $25"),
    b("saved100", "💰", "$100 saved", n(s.saved) >= 100, "Save $100"),
    b("invest25", "🌿", "$25 invested", n(s.invest) >= 25, "Have $25 in Invest"),
    b("invest100", "🌱", "$100 invested", n(s.invest) >= 100, "Have $100 in Invest"),
    b("invest250", "🌳", "$250 invested", n(s.invest) >= 250, "Have $250 in Invest"),
    b("give10", "💝", "$10 given", n(s.give) >= 10, "Put $10 in Give"),
    b("give50", "🤲", "$50 given", n(s.give) >= 50, "Put $50 in Give"),
    b("bought", "🎁", "Bought a goal", n(s.bought) >= 1, "Buy something you saved for"),
    b("bought3", "🛍️", "Smart shopper", n(s.bought) >= 3, "Buy 3 things you saved for"),
    // Levels, quests, bounties
    b("level5", "⭐", "Level 5", n(s.level) >= 5, "Reach level 5"),
    b("level10", "🌠", "Level 10", n(s.level) >= 10, "Reach level 10"),
    b("level20", "🚀", "Level 20", n(s.level) >= 20, "Reach level 20"),
    b("level30", "👑", "Level 30", n(s.level) >= 30, "Reach the top level"),
    b("quest1", "🗺️", "Adventurer", n(s.quests) >= 1, "Finish a weekly quest"),
    b("quest10", "🧭", "Explorer", n(s.quests) >= 10, "Finish 10 weekly quests"),
    b("bounty1", "🏹", "Bounty hunter", n(s.bounties) >= 1, "Finish a bounty"),
    // Battles
    b("win1", "⚔️", "First victory", n(s.wins) >= 1, "Win a battle"),
    b("win10", "🥇", "10 wins", n(s.wins) >= 10, "Win 10 battles"),
    b("win25", "🥊", "Battle master", n(s.wins) >= 25, "Win 25 battles"),
    b("giant", "🗡️", "Giant slayer", n(s.giant) >= 1, "Beat someone older in a battle"),
  ];
}

/* ---------- battles ---------- */
export const effAge = (p, adultAge = 18) => (p && p.adult ? adultAge : Number(p && p.age) || 0);
const round2 = (n) => Math.round(n * 100) / 100;
// Younger player's score multiplier; the older player is always 1.
export function handicaps(a, b, config) {
  const bc = gameCfg(config).battles;
  const aa = effAge(a, bc.adultAge), ab = effAge(b, bc.adultAge);
  const r = round2(Math.min(1 + bc.handicapPerYear * Math.abs(aa - ab), bc.handicapMax));
  return { [a.id]: aa < ab ? r : 1, [b.id]: ab < aa ? r : 1 };
}
// Team version: compares each team's average age.
export function teamHandicaps(teamA, teamB, config) {
  const bc = gameCfg(config).battles;
  const avg = (t) => t.reduce((s, p) => s + effAge(p, bc.adultAge), 0) / (t.length || 1);
  const h = handicaps({ id: "a", age: avg(teamA) }, { id: "b", age: avg(teamB) }, config);
  return { a: h.a, b: h.b };
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
const choreOf = (chores, id) => (chores || []).find((c) => c.id === id);
// How much one entry counts. A Wildcard twist can make one chore count double.
const weight = (b, e) => (b.twist && b.twist.choreId === e.choreId ? 2 : 1);
// Raw points for one player's entries in this battle.
function rawPoints(b, list, chores) {
  if (b.mode === "race") return list.reduce((s, e) => s + weight(b, e), 0);
  if (b.mode === "blitz" || b.mode === "grownups" || isRaid(b.mode)) {
    return list.reduce((s, e) => s + baseChoreXp(choreOf(chores, e.choreId)) * weight(b, e), 0);
  }
  if (b.mode === "territory") {
    return list.filter((e) => (choreOf(chores, e.choreId) || {}).assign === "pool").reduce((s, e) => s + weight(b, e), 0);
  }
  return 0;
}
// Live scores. entriesBy: { personId: [entries] }. chores: config chores.
export function battleScores(b, entriesBy, chores) {
  const out = {};
  for (const p of b.players) {
    const list = battleEntries(entriesBy[p], b.startAt, b.endAt);
    let raw;
    if (b.mode === "bingo") raw = bingoMarks(b, list, p).filter(Boolean).length;
    else raw = rawPoints(b, list, chores);
    const h = (b.handicap && b.handicap[p]) || 1;
    out[p] = { raw, adj: b.mode === "bingo" ? raw : round2(raw * h) };
  }
  return out;
}
// Team totals for team modes (raid, grownups).
export function teamScores(b, entriesBy, chores) {
  const per = battleScores({ ...b, handicap: {} }, entriesBy, chores);
  const out = {};
  for (const side of Object.keys(b.teams || {})) {
    const raw = b.teams[side].reduce((s, p) => s + (per[p] ? per[p].raw : 0), 0);
    const h = (b.teamHandicap && b.teamHandicap[side]) || 1;
    out[side] = { raw, adj: round2(raw * h) };
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
    for (const e of list) { n += weight(b, e); if (n * h >= b.params.n - 1e-9) { out[p] = e.t; break; } }
  }
  return out;
}

/* ---------- Chore Bingo ---------- */
export const BINGO_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
// A 3×3 card from the given chore ids, shuffled by a seed; chores repeat when there are fewer than 9.
export function bingoCard(choreIds, seed) {
  const ids = [...choreIds].sort();
  if (!ids.length) return [];
  let h = hash(String(seed));
  const next = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = (h ^ (h >>> 13)) >>> 0; return h; };
  const pool = [];
  while (pool.length < 9) pool.push(...ids);
  for (let i = pool.length - 1; i > 0; i--) { const j = next() % (i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 9);
}
// Which squares a player has marked. Each chore done marks the first open square with that chore.
export function bingoMarks(b, list, p) {
  const card = (b.params && b.params.card) || [];
  const marks = card.map((_, i) => ((b.params.free || {})[p] || []).includes(i));
  for (const e of list) {
    const i = card.findIndex((c, k) => c === e.choreId && !marks[k]);
    if (i >= 0) marks[i] = true;
  }
  return marks;
}
export const bingoHasLine = (marks) => BINGO_LINES.some((l) => l.every((i) => marks[i]));
// Free squares for the younger player: the center, plus one more with a gap of 4+ years.
export function bingoFree(a, c, config, seed) {
  const bc = gameCfg(config).battles;
  const aa = effAge(a, bc.adultAge), ac = effAge(c, bc.adultAge);
  if (aa === ac) return {};
  const young = aa < ac ? a.id : c.id;
  const free = [4];
  if (Math.abs(aa - ac) >= 4) free.push([0, 2, 6, 8][hash(String(seed)) % 4]);
  return { [young]: free };
}

/* ---------- Goal Showdown ---------- */
// Share of the weekly goal, measured against at least the recent average so a tiny goal can't win.
export function showdownScore(net, goal, avg) {
  const base = Math.max(Number(goal) || 0, Number(avg) || 0);
  return base > 0 ? round2(Math.max(0, net) / base) : 0;
}

/* ---------- Boss Raid ---------- */
export const BOSSES = [
  ["sock", "🧦", "Sock Goblin"], ["dish", "🍽️", "Dish Hydra"], ["toy", "🧸", "Toy Kraken"],
  ["tornado", "🌪️", "Mess Tornado"], ["chaos", "🐉", "Chaos Dragon"],
];
export const bossFor = (beaten) => {
  const i = Math.max(0, beaten || 0);
  const b = BOSSES[Math.min(i, BOSSES.length - 1)];
  return { id: b[0], emoji: b[1], name: i >= BOSSES.length ? `${b[2]} ${i - BOSSES.length + 2}` : b[2], tier: i };
};
export const raidHp = (members, days, tier) => Math.round(60 * members * days * (1 + 0.25 * (tier || 0)));
// Baby Boss Raid: a tiny one-day boss for younger kids or a quick team-up. No tiers, so it never gets harder.
export const BABY_BOSSES = [["dustbunny", "🐰", "Dust Bunny"], ["crumb", "🍪", "Crumb Critter"], ["sockling", "🧦", "Sockling"], ["puddle", "💧", "Puddle Blob"], ["fuzz", "🧸", "Fuzzball"]];
export const babyBossFor = (beaten) => {
  const i = Math.max(0, beaten || 0), b = BABY_BOSSES[i % BABY_BOSSES.length], round = Math.floor(i / BABY_BOSSES.length);
  return { id: b[0], emoji: b[1], name: round ? `${b[2]} ${round + 1}` : b[2], tier: 0 };
};
export const babyRaidHp = (members) => 15 * Math.max(1, members || 1); // about a chore and a half per person

/* ---------- Wildcard ---------- */
export const WILDCARD_MODES = ["race", "blitz", "territory", "bingo"];

// Decide a battle. `final` means time is up. Returns null while still undecided, else
// { winner, tie, noContest, reason } (team modes use winnerSide instead of winner).
export function decide(b, entriesBy, chores, final) {
  const [a, c] = b.players;
  if (b.mode === "race") {
    const f = raceFinish(b, entriesBy);
    const done = b.players.filter((p) => f[p] != null).sort((x, y) => f[x] - f[y]);
    if (done.length) return { winner: done[0], tie: false, reason: "Finished first" };
    if (!final) return null;
    return compareScores(battleScores(b, entriesBy, chores), a, c, "Most chores when time ran out");
  }
  if (b.mode === "blitz") {
    if (!final) return null;
    return compareScores(battleScores(b, entriesBy, chores), a, c, "Most XP when time ran out");
  }
  if (b.mode === "territory") {
    if (!final) return null;
    return compareScores(battleScores(b, entriesBy, chores), a, c, "Claimed the most shared chores");
  }
  if (b.mode === "bingo") {
    // First to complete a line, by the time of the chore that completed it.
    const when = {};
    for (const p of b.players) {
      const list = battleEntries(entriesBy[p], b.startAt, b.endAt);
      when[p] = bingoHasLine(bingoMarks(b, [], p)) ? b.startAt : null;
      for (let i = 0; i < list.length && when[p] == null; i++) {
        if (bingoHasLine(bingoMarks(b, list.slice(0, i + 1), p))) when[p] = list[i].t;
      }
    }
    const done = b.players.filter((p) => when[p] != null).sort((x, y) => when[x] - when[y]);
    if (done.length) return { winner: done[0], tie: false, reason: "Bingo!" };
    if (!final) return null;
    const s = battleScores(b, entriesBy, chores);
    const freeOnly = (p) => s[p].raw === ((b.params.free || {})[p] || []).length;
    if (freeOnly(a) && freeOnly(c)) return { noContest: true, reason: "Nobody did a chore" };
    return compareScores(s, a, c, "Most squares when time ran out");
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
  if (b.mode === "judge") {
    // Decided by a parent; time running out with work undone ends it.
    const at = b.attempts || {};
    const did = (p) => !!(at[p] && at[p].entryId);
    if (!final) return null;
    if (!did(a) && !did(c)) return { noContest: true, reason: "Nobody did the chore" };
    if (!did(a) || !did(c)) return { winner: did(a) ? a : c, tie: false, reason: "Only one did the chore" };
    return null;
  }
  if (isRaid(b.mode)) {
    const s = teamScores(b, entriesBy, chores);
    if (s.a.raw >= b.params.hp) return { winnerSide: "a", reason: `${b.params.bossName} is beaten!` };
    if (!final) return null;
    return s.a.raw ? { lostSide: "a", reason: `${b.params.bossName} got away` } : { noContest: true, reason: "Nobody did a chore" };
  }
  if (b.mode === "grownups") {
    if (!final) return null;
    const s = teamScores(b, entriesBy, chores);
    if (!s.a.raw && !s.b.raw) return { noContest: true, reason: "Nobody did a chore" };
    if (s.a.adj === s.b.adj) return { tie: true, reason: "Most XP when time ran out" };
    return { winnerSide: s.a.adj > s.b.adj ? "a" : "b", reason: "Most XP when time ran out" };
  }
  if (b.mode === "streakduel" || b.mode === "showdown") return null; // decided by the server's daily check
  return final ? { noContest: true, reason: "Unknown mode" } : null;
}
function compareScores(s, a, c, reason) {
  if (!s[a].raw && !s[c].raw) return { noContest: true, reason: "Nobody did a chore" };
  if (s[a].adj === s[c].adj) return { tie: true, reason };
  return { winner: s[a].adj > s[c].adj ? a : c, tie: false, reason };
}
// Which side a player is on in a team battle.
export const sideOf = (b, p) => (b.teams ? Object.keys(b.teams).find((k) => b.teams[k].includes(p)) : null);
// Did this player win? Works for solo, 1v1, and team battles.
export const isWinner = (b, r, p) => !!r && (r.winner === p || (!!r.winnerSide && sideOf(b, p) === r.winnerSide));
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
    if (TIMED.includes(b.mode) || b.mode === "judge") {
      const at = (b.attempts || {})[p];
      // A timed run that didn't pass the parent's check earns nothing.
      return !!(at && (at.ms != null || at.entryId) && !at.void) && (b.quality || {})[p] !== false;
    }
    if (b.mode === "streakduel" || b.mode === "showdown") return true;
    return ((b.scores && b.scores[p] && b.scores[p].raw) || 0) > 0;
  };
  const k = ["streakduel", "showdown"].includes(b.mode) ? 2 : 1; // multi-day modes pay double
  for (const p of b.players) {
    if (isRaid(b.mode)) out[p] = tried(p) ? (result.winnerSide ? (b.mode === "babyraid" ? XP.babyRaidWin : XP.raidWin) : XP.loss) : 0;
    else if (result.tie) out[p] = tried(p) ? XP.tie * k : 0;
    else if (isWinner(b, result, p)) out[p] = !b.teams || tried(p) ? XP.win * k : 0; // teammates who did nothing get nothing
    else out[p] = tried(p) ? XP.loss * k : 0;
  }
  return out;
}

/* ---------- rewards, family goal, raises ---------- */
// Levels at which a reward can be claimed: its level, then every `repeat` levels after (0 = once).
export function rewardSlots(reward, maxLevel) {
  const out = [];
  const start = Number(reward.level) || 1, every = Number(reward.repeat) || 0;
  for (let l = start; l <= maxLevel; l += every || Infinity) { out.push(l); if (!every) break; }
  return out;
}
// The first reachable slot not claimed yet, or null.
export const nextRewardSlot = (reward, maxLevel, claimedSlots) =>
  rewardSlots(reward, maxLevel).find((l) => !(claimedSlots || []).includes(l)) ?? null;
export function familyProgress(total, goal) {
  if (!goal || !(goal.target > 0)) return null;
  const into = Math.max(0, total - (goal.startTotal || 0));
  return { into, target: goal.target, frac: Math.min(1, into / goal.target), done: into >= goal.target };
}
// Raises due since the last one applied: one per `every` levels.
export const raisesDue = (level, perkLevel, every) =>
  every > 0 ? Math.max(0, Math.floor(level / every) - Math.floor((perkLevel || 0) / every)) : 0;

/* ---------- weekly quests ---------- */
// ctx: { entries (this week, not reversed, with .hour in family time), chores, cotdOf(date),
//        checklistDays, wins, goal, netByFri }
export const QUESTS = [
  { id: "variety", emoji: "🌈", text: "Do 3 different chores in one day", target: 3, xp: 40,
    progress: (c) => { const by = {}; for (const e of c.entries) (by[e.date] = by[e.date] || new Set()).add(e.choreId); return Math.max(0, ...Object.values(by).map((s) => s.size)); } },
  { id: "early", emoji: "🌅", text: "Do a chore before 9 AM", target: 1, xp: 30, progress: (c) => c.entries.filter((e) => e.hour < 9).length },
  { id: "ten", emoji: "🔟", text: "Do 10 chores this week", target: 10, xp: 40, progress: (c) => c.entries.length },
  { id: "cotd", emoji: "⭐", text: "Do a Chore of the Day", target: 1, xp: 30, progress: (c) => c.entries.filter((e) => c.cotdOf(e.date) === e.choreId).length },
  { id: "checklist5", emoji: "✅", text: "Finish your daily checklist 5 days this week", target: 5, xp: 50, progress: (c) => c.checklistDays },
  { id: "goalfri", emoji: "🎯", text: "Reach your weekly goal by Friday", target: 1, xp: 50, progress: (c) => (c.goal > 0 && c.netByFri >= c.goal ? 1 : 0) },
  { id: "battle", emoji: "⚔️", text: "Win a battle", target: 1, xp: 40, progress: (c) => c.wins },
  { id: "big", emoji: "💪", text: "Do 2 double-size chores", target: 2, xp: 40, progress: (c) => c.entries.filter((e) => ((choreOf(c.chores, e.choreId) || {}).mult || 1) >= 2).length },
];
// This week's three quests for a person: the same on every device, different each week.
export function weeklyQuests(week, personId) {
  let h = hash(week + ":" + personId);
  const pool = [...QUESTS], out = [];
  while (out.length < 3 && pool.length) { out.push(pool.splice(h % pool.length, 1)[0]); h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 13; }
  return out;
}
export function questStatus(week, personId, ctx) {
  return weeklyQuests(week, personId).map((q) => {
    const p = Math.min(q.target, q.progress(ctx) || 0);
    return { id: q.id, emoji: q.emoji, text: q.text, target: q.target, xp: q.xp, progress: p, done: p >= q.target };
  });
}
