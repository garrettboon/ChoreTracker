# Boon Bank: Game Layer Plan

XP, levels, unlocks, streak mechanics, rewards, quests, and chore battles.

Status: **planned, not started**. Each phase below is sized to ship on its own and deploys through the existing GitHub Action (push to `main`).

---

## 1. Decisions already made

| Topic | Decision |
|---|---|
| XP basis | Effort, not dollars. XP comes from the chore's `mult`, so every person earns the same XP for the same chore regardless of pay rate. |
| XP direction | XP never goes down, except when a parent reverses a chore. **Level never goes down** (we store the highest level reached) and unlocks are permanent. Deductions cost money, not XP. |
| Starter creatures | The existing 12 creatures stay free for everyone. New creatures unlock with levels. |
| Adults | Dad earns XP, levels up, and can battle. **Mom may be added later**, so nothing may hard-code `"dad"`. Every adult is just a `kids[]` entry with `adult: true`. |
| Rewards | Both real-world rewards (parent-defined, claim + approve) and a family co-op XP bar. Money perks are **off by default** (optional parent setting, Phase 5). |
| Competition | Co-op family bar plus opt-in sibling battles. No standing leaderboard. |
| Battle stakes | XP only, never money. Losers still earn participation XP. |
| Handicaps | Automatic, by age (formula in §6.3). |
| Result confirmation | A parent **or** the opponent can confirm speed results. |

---

## 2. How the current app shapes this design

Things in the existing code that the plan has to respect:

1. **Parent actions write to Firestore straight from the browser.** Reversing a chore, marking a deduction earned back, cash-out, and buying a goal are all client-side transactions in `public/app.js`. Only chore logging (`completeChore`) runs on the server. So XP cannot be awarded only inside callable functions; it has to come from **Firestore triggers** that watch `weeks/`, `bank/`, and `prefs/`.
2. **Kids can write their own `prefs/{kidId}` doc**, including `prLog` (the daily checklist) and `creature`. That means:
   - Checklist XP is self-reported, so keep it small and only award it for today or yesterday (a backdated checkbox earns nothing).
   - Locked creatures and cosmetics must be enforced in `firestore.rules`, not just hidden in the UI.
3. **Badges and streaks are computed in the browser** (`badgeList`, `streak`, `bestStreak`). To award XP for them, the logic must also run on the server. Solution: a shared game module (§3.1).
4. **Shared "Anyone" chores have one daily limit for all non-adult kids.** Adults' completions don't count against the kids' limit. This matters for Race, Blitz, Bingo, and Territory (§6).
5. **Adults have no paired device.** Dad uses the parent screen's "Dad" tab, signed in with Google. To let each parent act as *their own* adult profile (and support Mom), adults get an optional `email` field in config (§3.4).
6. **Parents have no push tokens today.** Only paired devices do. Parent notifications (reward claims, disputes, level-ups) need a small addition (Phase 5).
7. **The client uses device-local time; the server uses `America/Denver`.** All new date logic runs on the server with `localParts()`.
8. **No tests exist and the deploy workflow has no test step.** Phase 0 adds them before the game logic grows.

---

## 3. Architecture

### 3.1 Shared game module

A new `shared/game.js` (plain ES module, no dependencies) holds every rule that both sides need:

- XP table and the `xpForLevel()` / `levelFor(total)` curve
- Unlock catalog (creatures, cosmetics, titles, battle modes, freezes) keyed by level
- Badge definitions (moved out of `badgeList` in `app.js`)
- Streak math (`prComplete`, `streak`, `bestStreak`, aware of freeze days)
- Handicap formula and battle mode definitions
- Chore of the Day picker

Deployment: a `predeploy` hook in `firebase.json` copies it to `public/game.js` and `functions/game.mjs`. The browser imports it directly. Functions load it with `await import("./game.mjs")`. Both copies are gitignored, so the source of truth is `shared/game.js`.

### 3.2 XP ledger (server-only, idempotent)

Every XP award is an event with a **deterministic key**, so a trigger that fires twice never double-counts:

| Key | Source |
|---|---|
| `chore:<entryId>` | a chore entry in `weeks/` |
| `pr:<date>` | all checklist items done on that date |
| `streak<N>:<date>` | streak milestone reached |
| `goal:<week>` | weekly goal hit (at cash-out) |
| `redeem:<deductionId>` | deduction earned back |
| `sgoal:<goalId>` | savings goal bought |
| `badge:<badgeId>` | badge earned |
| `battle:<battleId>` | battle result |
| `quest:<questId>` | quest completed |
| `backfill:v1` | one-time seed from history |

A single helper `awardXp(personId, key, amount, reason)` runs in a transaction:

- If `xp/{id}/events/{key}` exists, it does nothing.
- Otherwise it writes the event, increments `total`, recomputes the level, and adds new unlocks. If the level went up, it sets `levelUp: {level, at, unlocks}` so the client can play the celebration once.
- It also increments the family bar (`xp/_family`).

`revokeXp(personId, key)` deletes the event and decrements `total`. It is used only when a parent reverses a chore. Level and unlocks stay.

**Triggers** (Firestore `onDocumentWritten`):

| Trigger | Awards |
|---|---|
| `weeks/{id}` | New or restored chore entries give chore XP; reversed entries revoke it. Deductions that flip to `redeemed` give redeem XP. A week that flips to `closed` with `cashout.met` gives goal XP. Also updates live battle scores (§6). |
| `prefs/{id}` | A `prLog` change for today or yesterday that completes the checklist gives `pr:` XP plus any streak milestone. |
| `bank/{id}` | A new `archived[]` entry gives savings-goal XP. After any award, badges are re-evaluated and new ones give badge XP. |

`completeChore` itself stays unchanged. The trigger picks up its entry. It returns the XP estimate so the UI can show "+10 XP" instantly.

### 3.3 Level curve

`XP to go from level L to L+1 = round(60 × L^1.3)`, capped at level 30. All constants live in `shared/game.js` so they are easy to retune after two weeks of real data.

Assuming a kid earns about 80 XP a day (around 5 chores plus the checklist):

| Level | Total XP | About when |
|---|---|---|
| 2 | 60 | day 1 |
| 3 | 208 | day 3 |
| 5 | 822 | day 10 |
| 8 | 2,677 | 5 weeks |
| 10 | 4,617 | 2 months |
| 12 | 7,169 | 3 months |
| 15 | 12,224 | 5 months |
| 20 | 24,172 | about 10 months |

### 3.4 Config additions (`app/config`, parent-editable)

```js
kids: [{ ..., adult: true, email: "dad@example.com" }],   // email optional; maps a Google sign-in to an adult profile
game: {
  enabled: true,
  xp: { chore: 10, checklist: 5, goal: 50, redeem: 20, savingsGoal: 50, badge: 25 },
  choreOfDay: { enabled: true, pinned: null },            // pinned: a choreId to force
  streakMultiplier: { enabled: true, minStreak: 7, mult: 1.25 },
  battles: { enabled: true, modesOff: [], quietHours: { start: "20:30", end: "07:00" }, dailyCap: 3,
             handicapPerYear: 0.08, handicapMax: 1.5, adultAge: 18 },
  rewards: [ { id, level, name, repeat: false } ],        // Phase 5
  familyGoal: { name: "Pizza night", target: 2000, since: <ms> }, // Phase 5
  moneyPerks: { enabled: false, ... },                    // Phase 5, optional
}
```

### 3.5 New collections

| Path | Written by | Read by | Contents |
|---|---|---|---|
| `xp/{personId}` | functions only | everyone signed in | `total`, `level`, `maxLevel`, `unlocked[]`, `freezes`, `frozenDates[]`, `pb{choreId: ms}`, `battle{w,l,t}`, `titles[]`, `levelUp` |
| `xp/{personId}/events/{key}` | functions only | parents | `amount`, `reason`, `t` |
| `xp/_family` | functions only | everyone signed in | `total`, `sinceGoal` |
| `battles/{id}` | functions only | everyone signed in | see §6.5 |
| `claims/{id}` | the kid creates, parents update | everyone signed in | reward claims (Phase 5) |
| `quests/{id}` | functions and parents | everyone signed in | Phase 7 |
| `parentTokens/{uid}` | that parent | parents | push token for parent notifications (Phase 5) |

### 3.6 Security rule changes (summary)

- `xp/**` and `battles/**`: `allow read: if canRead(); allow write: if false;`
- `prefs/{kidId}`: a kid may set `creature` and `equipped.*` only to a value that is one of the 12 starters (listed in the rules) or in `get(xp/{kidId}).data.unlocked`.
- `claims/{id}`: a kid may create a claim for themself only if `xp.maxLevel >= reward level`. Only parents may change `status`.
- All new rules get emulator tests (Phase 0 sets that up).

---

## 4. Phases

Sizes: **S** is about a day, **M** is 2 to 4 days, **L** is a week or more.

### Phase 0: Foundations (S)
- Create `shared/game.js`, add the predeploy copy step, and update `.gitignore`.
- Move badge and streak logic from `app.js` into it without changing behavior.
- Add `node --test` for the shared module and `@firebase/rules-unit-testing` for the security rules. Add a test step before deploy in `.github/workflows/deploy.yml`.
- Add optional `email` to adult profiles in Settings. The parent screen's "me" tab uses the matching adult (falls back to today's behavior when unset).

**Done when:** the app works exactly as before, and tests run in CI.

### Phase 1: XP, levels, avatar unlocks (M)
- `awardXp` / `revokeXp` plus the three triggers (§3.2).
- One-time `backfillXp` callable run from the parent screen, so existing work counts. It uses `bank.stats.chores`, open weeks, goal hits, redemptions, best streak, and current badges.
- Kid screen: level ring on the creature, XP bar ("240 / 310 XP to level 6"), and "+10 XP" toasts.
- Level-up moment: full-screen overlay with big confetti, the new level, and what was unlocked. It is shown once, using `levelUp` and a per-device "seen" marker.
- Creature picker shows locked creatures with 🔒 and "Level N". Rules enforce it.
- Display screen: level badge on each lane, and "⭐ Warren reached level 6!" in the ticker.
- Parent screen: per-person XP history (the events list) and "reverse" also shows the XP removed.

New creatures (the 12 starters stay free):

| Level | Creature | Level | Creature |
|---|---|---|---|
| 2 | 🦔 Hedgehog | 13 | 🦅 Eagle |
| 3 | 🦥 Sloth | 14 | 🤖 Robot |
| 4 | 🐺 Wolf | 16 | 👾 Space Invader |
| 6 | 🦁 Lion | 18 | 🧙 Wizard |
| 7 | 🐼 Panda | 20 | 🐲 Elder Dragon |
| 9 | 🦩 Flamingo | 25 | 🦸 Hero |
| 11 | 🐳 Whale | 30 | 👑 Royal (any creature gets a crown) |

**Done when:** doing a chore raises XP within a few seconds on every screen. Reversing it removes the XP. Leveling up shows the celebration once. A kid can't select a locked creature, even by writing Firestore directly.

### Phase 2: Creature growth, cosmetics, titles (M)
Creatures are emoji, so growth uses CSS and overlays instead of new art:

| Stage | Levels | Look |
|---|---|---|
| Hatchling | 1 to 4 | as today |
| Buddy | 5 to 9 | larger, colored ring |
| Champion | 10 to 19 | glow and a subtle idle bounce |
| Legend | 20+ | animated aura and sparkle trail on the goal track |

- **Accessories** (equip one): 🎩 L3, 🕶️ L5, 🎀 L6, 🧢 L8, 👑 L12, 🪄 L17. Stored in `prefs.equipped.hat`.
- **Screen themes:** Ocean L4, Forest L7, Space L10, Candy L14, Gold L22 (CSS variable sets on the kid view).
- **Trail backgrounds** for the goal track, and **confetti styles** (stars, hearts, coins).
- **Titles** shown under the name on the display, for example "Rookie" L1, "Helper" L3, "Dish Destroyer" (50 dish chores), "Laundry Legend", "Comeback Kid", "Battle Champ" (10 wins). A "Wardrobe" card on the kid view lets them equip items.
- Every item respects `prefers-reduced-motion`.

### Phase 3: Chore of the Day, streak multiplier, streak freezes (S to M)
- **Chore of the Day:** picked each day from family chores with a date-seeded hash in `shared/game.js`, so client and server agree. A parent can pin a specific chore. It gives **double XP** and shows a ⭐ ribbon on that chore and on the display.
- **Streak multiplier:** all XP counts ×1.25 while the checklist streak is 7 days or more. The kid view shows "🔥 ×1.25".
- **Streak freezes:**
  - Earned at levels 5, 10, 15, … and at the 30-day streak milestone. A person holds at most 2.
  - A new scheduled function runs at 00:10 family time. If yesterday's checklist was incomplete and a freeze is available, it spends one and adds the date to `xp.frozenDates`. Streak math treats frozen dates as complete.
  - The kid sees "🧊 Freeze used for Tuesday. Streak saved!"
  - Frozen dates live in `xp/` (server-only), so kids can't fake them.

### Phase 4: Battles v1 (L)
The challenge flow, the battle engine, and three modes: **Race**, **Time Trial** (plus **Ghost Race**), and **Blitz**. See §6.

### Phase 5: Rewards and the family bar (M)
- **Reward table** in Settings, for example: L5 "Pick Friday dinner", L10 "30 minutes later bedtime (once)", L15 "Ice cream trip with a parent". Each is one-time or repeatable (repeatable ones can be claimed again every N levels).
- **Kid flow:** a reward card shows "Claim". The claim goes to the parent screen's Rewards tab for approval, and the kid sees Pending, then Approved or Fulfilled.
- **Parent push:** `parentTokens/{uid}` plus an "Enable notifications" button on the parent screen. This is used for claims, battle disputes, and optional level-up alerts.
- **Family XP bar:** everyone's XP (adults included) fills a shared bar on the display header toward `familyGoal`. Reaching it plays a whole-family celebration. The parent then marks it done and sets the next goal.
- **Money perks (optional, off by default):** a one-time rate bump at milestone levels, or bonus invest interest. Changes apply only through the parent's own Settings save, never automatically.

### Phase 6: Battles v2 (L)
**Chore Bingo**, **Territory**, **Judge's Pick**, **Streak Duel**, **Goal Showdown**, battle badges and titles, and a battle record on profiles.

### Phase 7: Quests and Battles v3 (L)
- **Weekly quests:** each Monday every person gets 3 quests drawn from templates the server can check from existing data. Examples: "Do 3 different chores in one day," "A chore before 9am," "Hit your goal by Friday," "Earn back a deduction," "Win a battle." Each gives 30 to 60 XP.
- **Parent quests:** a one-off bounty with a name, XP, an optional person, and a deadline, for example "Clean out the garage together, 200 XP." A parent marks it complete.
- **Boss Raid**, **Kids vs. Grown-ups**, and **Wildcard** battle modes.

---

## 5. XP table (starting values, all tunable)

| Action | XP |
|---|---|
| Family chore | 10 × chore `mult` (bathroom and laundry = 20) |
| Chore of the Day | ×2 |
| Streak of 7+ days active | ×1.25 on everything |
| Full daily checklist (today or yesterday only) | 5 |
| Streak milestones: 3 / 7 / 14 / 30 / 60 / 100 days | 25 / 50 / 75 / 150 / 250 / 400 |
| Weekly goal reached | 50 |
| Deduction earned back | 20 |
| Savings goal bought | 50 |
| New badge | 25 |
| Battle win / tie / loss | 40 / 25 / 15 (×2 for multi-day modes) |
| Co-op battle success | 50 each |
| Weekly quest | 30 to 60 |

---

## 6. Battles

### 6.1 Flow
1. **Challenge.** From their screen, a person taps **Battle**, picks an opponent (or a team for co-op modes), and picks a mode. Modes the challenger hasn't unlocked show 🔒 and "Level N". Some modes also ask for options (N chores, window length, which chore).
2. **Invite.** The opponent gets a push notification and a card: "Warren challenged you to a Race (first to 3). Accept / Decline." Declining carries no penalty.
3. **Live.** Once accepted, a head-to-head scoreboard appears on both kid screens and as a banner on the family display, with both creatures facing off and progress bars.
4. **Confirm.** Speed modes (Race, Time Trial, Blitz, Territory) go to "awaiting confirmation." A parent **or** the opponent taps "Looks good." The opponent can instead tap "Dispute," which sends it to a parent. If nobody acts within 12 hours, the result auto-confirms. Nobody can confirm their own result, and a parent who is a player can't confirm their own battle.
5. **Result.** Winner celebration, XP to both players, and the battle record updates.

### 6.2 Modes

| Mode | Unlocks | Players | Scoring | Handicap |
|---|---|---|---|---|
| **Race** | L1 | 1v1 | First to N chores (N = 3 by default, 2 to 6) completed after the start | Younger's count × multiplier |
| **Time Trial** | L1 | 1v1 | Same chore. Each taps Start, then Done (Done logs the chore normally). Fastest wins. | Younger's time ÷ multiplier |
| **Ghost Race** | L1 | solo | Beat your own best time on a chore (`xp.pb`) | none |
| **Blitz** | L3 | 1v1 | Most chore XP inside a window (30 min, 1 hour, or rest of day) | Younger's XP × multiplier |
| **Chore Bingo** | L5 | 1v1 | Same 3×3 card of chores. First to finish a row, column, or diagonal wins. | Younger gets the free center square. With a gap of 4 or more years, one more random square is pre-filled. |
| **Territory** | L6 | 1v1, kids only | Rest of the day. Each shared "Anyone" chore you complete is a claim. Most claims wins. | Younger's claims × multiplier |
| **Judge's Pick** | L8 | 1v1 | Same chore. A parent picks the better job (the parent judges with age in mind). | none (parent's judgment) |
| **Streak Duel** | L10 | 1v1 | Starts tomorrow. Whoever misses the daily checklist first loses. Freezes don't count. Ends in a tie after 14 days. | none (age-neutral) |
| **Goal Showdown** | L12 | 1v1 | Best percentage of the weekly goal at cash-out (see the lowball rule below) | none (percentages are already fair) |
| **Boss Raid** | L15 | 2+ co-op | Team vs. a boss with HP. Chore XP does damage. Win by beating it before the deadline (1 to 3 days). | none. HP scales with team size and days. |
| **Kids vs. Grown-ups** | L15 | teams | Race or Blitz scoring summed per team | Kids' team × multiplier using the average age gap |
| **Wildcard** | L20 | 1v1 | Random unlocked mode plus a twist (for example "bathroom chores count double" or "only chores you've never done") | per underlying mode |

The unlock level is checked against the **challenger's** level. The opponent can accept any mode.

**Goal Showdown lowball rule:** score = this week's net earned ÷ max(goal, the 4-week average of net earned). Setting a tiny goal can't win.

**Boss roster:** each boss beaten unlocks the next, stronger one. For example 🧦 Sock Goblin, 🍽️ Dish Hydra, 🧸 Toy Kraken, 🌪️ Mess Tornado, 🐉 Chaos Dragon.

### 6.3 Automatic age handicap

```
ageOf(p)   = p.adult ? config.game.battles.adultAge (18) : p.age
gap        = |ageOf(a) − ageOf(b)|
multiplier = min(1 + handicapPerYear × gap, handicapMax)   // defaults 0.08 and 1.5
```

The multiplier applies to the **younger** player only. For example:

| Matchup | Gap | Younger's multiplier |
|---|---|---|
| Teslyn (12) vs. Warren (10) | 2 | ×1.16 |
| Teslyn (12) vs. Maggie (8) | 4 | ×1.32 |
| Maggie (8) vs. Dad | 10 | ×1.50 (cap) |

- In Race, "first to N" uses adjusted progress. Maggie needs about 2.3 real chores to Teslyn's 3.
- The battle card always shows the handicap ("Maggie ×1.32") so it's transparent.
- The factor and the cap are parent settings.

### 6.4 Guardrails
- Opt-in only. A pending challenge expires after 2 hours.
- One active battle per pair.
- A daily cap per person (default 3).
- After a decline, the same pair has a 1-hour cooldown.
- No new battles during quiet hours (default 20:30 to 07:00).
- Parents can cancel any battle, switch off individual modes, or switch battles off entirely.
- **Shared chore limits:** in Race, Blitz, and Bingo, taking a shared chore can block a sibling. That is intentional in Territory. For the other modes, the Time Trial chore picker only offers chores with enough of today's limit left for both players, and Bingo cards prefer chores with `limit ≥ 2` or chores assigned to each player.
- Adults' shared-chore completions don't count against kids' limits today, so Territory is kids-only.
- Time Trial: an attempt longer than 2 hours voids. A time under a per-chore floor (default 60 seconds) is flagged for parent confirmation even if the opponent confirmed.

### 6.5 Battle data and functions

`battles/{id}`:

```js
{
  mode, status,               // pending | active | confirming | done | declined | cancelled | expired
  players: [idA, idB],        // or teams: { a: [...], b: [...] } for team modes
  challenger, createdAt, acceptedAt, startAt, endAt,
  params: { n, windowMin, choreId, card: [...9 choreIds], bossId, twist },
  handicap: { [personId]: 1.32 },
  scores: { [personId]: { raw, adj } },       // live, updated by the weeks/ trigger
  attempts: { [personId]: { startAt, stopAt, ms, entryId } },   // Time Trial
  result: { winner, tie, confirmedBy, disputedBy, at },
}
```

Callable functions:

| Function | Purpose |
|---|---|
| `createBattle` | Checks identity, unlock level, guardrails, and chore availability, then computes the handicap |
| `respondBattle` | Accept or decline |
| `cancelBattle` | By the challenger while pending, or by any parent |
| `startAttempt` / `finishAttempt` | Time Trial. `finishAttempt` reuses the `completeChore` transaction logic, so the chore pays and earns XP normally. |
| `confirmResult` / `disputeResult` | Confirmation step (§6.1) |
| `judgeBattle` | Judge's Pick |

Scheduled and trigger functions:

- `battleTick` runs every 5 minutes. It expires pending challenges, finishes ended windows, auto-confirms after 12 hours, and runs Streak Duel checks after midnight.
- The `weeks/` trigger recomputes scores for active battles involving that person.

Identity: a kid acts through their paired device's `kidId`. An adult acts through a Google sign-in whose email matches their profile's `email` (§3.4).

---

## 7. Screens touched

| Screen | Changes |
|---|---|
| Kid view | Level ring and XP bar, level-up overlay, locked creatures, Wardrobe (P2), Chore of the Day ribbon and streak multiplier chip (P3), Battle button and invites and live scoreboard (P4), Rewards card (P5), Quests card (P7) |
| Family display | Level badges, titles, level-up ticker, Chore of the Day, live battle banner, family XP bar, boss health bar |
| Parent view | XP history per person, backfill button, game settings (XP values, modes, quiet hours, handicap, Chore of the Day pin), Rewards tab with claims, battle confirm/dispute/judge queue, quest editor, "me" tab mapped by email |

---

## 8. Open items for later
- **Adding Mom:** Settings, "Add person," tick Adult, set her email, and add her to `PARENT_EMAILS`. Phase 0's email mapping is what makes this work. Nothing else is needed.
- **Seasons:** an optional quarterly season with seasonal cosmetics and a season-only badge. This is a refresh mechanism once people are past level 20.
- **Photo proof** for Time Trial and Judge's Pick. This needs Cloud Storage and rules, so it's deferred.
- **Retuning:** after 2 weeks of real use, check the XP per day per person and adjust the curve and table in `shared/game.js`.
