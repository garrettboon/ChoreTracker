# Boon Chore Tracker: Firebase setup

This folder is the complete app. You'll create a Firebase project, fill in three small settings, and deploy with one command. Plan on about 45 minutes the first time.

## What's in here

| Path | What it is |
|---|---|
| `public/` | The app itself (what the tablets load) |
| `public/config.js` | **You edit:** your Web Push key |
| `functions/index.js` | Server code: device pairing, chore logging, push reminders, XP, battles |
| `public/game.js` | Game rules: XP, levels, unlocks, battles (copied to `functions/game.mjs`) |
| `functions/.env` | **You create:** the parent Google accounts |
| `firestore.rules` | Security rules: who can read and change what |
| `.firebaserc` | **You edit:** your Firebase project ID |

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com and click **Create a project**. Name it something like `boon-bank`. Google Analytics isn't needed.
2. Note the **Project ID** shown under the name (for example `boon-bank-4f2a1`).
3. Bottom-left, click **Upgrade** and choose the **Blaze** plan. Add a card.
4. Set a budget alert so you're never surprised: Google Cloud console > **Billing** > **Budgets & alerts** > create a $5 budget with email alerts. Family-size usage should stay at $0.

## 2. Turn on the Firebase features

In the Firebase console for your project:

1. **Register a web app:** Project Overview > click the `</>` (Web) icon > give it a nickname > **Register app**. You don't need to copy the config it shows; Firebase Hosting supplies it automatically.
2. **Authentication:** Build > Authentication > **Get started**. Under **Sign-in method**, enable **Google** (pick your support email) and enable **Anonymous**.
3. **Firestore:** Build > Firestore Database > **Create database**. Pick a US location (for example `nam5`) and start in **production mode**. The rules in this folder replace the defaults when you deploy.
4. **Web Push key:** Project settings (gear icon) > **Cloud Messaging** tab > scroll to **Web Push certificates** > **Generate key pair**. Copy the long key.

## 3. Fill in your settings

1. Open `.firebaserc` and replace `YOUR-PROJECT-ID` with your Project ID.
2. Open `public/config.js` and paste the Web Push key between the quotes.
3. In the `functions` folder, copy `.env.example` to a new file named `.env` and list the parent Google accounts:
   ```
   PARENT_EMAILS=garrett@example.com,parent2@example.com
   ```
   Only these accounts can open the Parent screen. To change the list later, edit this file and deploy again.

## 4. Install the tools (once per computer)

1. Install **Node.js 20 LTS** from https://nodejs.org (use the default options).
2. Open a terminal (Windows: PowerShell; Mac: Terminal) and run:
   ```
   npm install -g firebase-tools
   firebase login
   ```
   A browser window opens; sign in with the Google account that owns the project.

## 5. Deploy

In the terminal, go into this folder and run:

```
cd path/to/boon-bank
cd functions
npm install
cd ..
firebase deploy
```

The first deploy takes a few minutes and may ask to enable some Google Cloud APIs. Answer **yes**. When it finishes, it prints your **Hosting URL**, like `https://boon-bank-4f2a1.web.app`. That's the app's address.

Run `firebase deploy` again any time you change a file.

You don't have to deploy by hand, though. Pushing to GitHub does it: every push to `main`, and every push to a `claude/` branch (the branches Claude Code works on), runs the **Deploy to Firebase** action in `.github/workflows/deploy.yml`. Before deploying, the action checks that the pushed commit includes whatever is live now, so a branch that started from older code can't quietly undo a change. If it refuses, merge the branch it names into yours and push again, or run the action by hand from the **Actions** tab with **force** ticked to deploy anyway. After a successful deploy from a `claude/` branch, the action moves `main` forward to that branch, so `main` always matches the live site. Progress and errors show under the repository's **Actions** tab.

## 6. First sign-in (your phone)

1. Open the Hosting URL in Chrome and tap **Parent sign-in**. Sign in with one of the accounts in `PARENT_EMAILS`.
2. The first parent sign-in creates the starter setup: Dad, Teslyn, Warren, and Maggie, with your chores, rates, and interest tiers. Check the **Settings** tab and adjust anything.
3. Your lane as Dad is its own tab at the start of the Parent screen. To give another grown-up a lane, add them under **Settings** > **People** and tick **Adult**.

## 7. Pair each tablet

Repeat for each kid's tablet and the leaderboard device:

1. On your phone: **Settings** tab > **Devices** > choose who the device is for > **Create pairing code**. Codes last 15 minutes.
2. On the tablet: open the Hosting URL in Chrome, open Chrome's menu, and tap **Add to Home screen** (or **Install app**). Open Boon Chores from the new home-screen icon.
3. Tap **Pair this device**, enter the code, and give the device a name.
4. On a kid's tablet, tap **Turn on chore reminders** and allow notifications. The Devices section under Settings on your phone will show "Reminders on."

For the leaderboard device, keep it plugged in. The app asks the screen to stay awake while it's open; if it still dims, turn on **Stay awake** in Android's Developer options (it keeps the screen on while charging).

## Everyday use

- **Kids** tap chores (and confirm, so a stray tap doesn't count; grown-ups' own lanes skip the confirmation and the what-was-it prompt), check off their daily list, set their goal after Sunday cash-out, split the week's savings between their goals, and choose where their bonus and interest go. Under **My money**, each card shows its total; tap Save or Invest to open the details.
- **Parents** use **Game** to confirm battle results and see everyone's level; **Activity** to review and reverse chores, or log one for someone without their tablet; **Views** for the family leaderboard and to open any kid's screen exactly as they see it; **Actions** for warnings (no money; the kid taps Got it on their screen, and you can turn one into a deduction later), deductions (add, mark earned back, or remove), and the Sunday cash-out (if a week was missed, it's combined with the next one into a single lump, with each week's goal judged on its own); **Savings goals** to add or edit goals, log purchases, or set a child's balances (for money from before the app, or to fix a mistake); and **Settings** for devices, people (tick **Adult** for a grown-up, who gets their own lane and tab instead of a place in the kid list), chores (each is one line; tap it to edit, and drag the ⠿ handle to reorder them; every chore has a max per person per day, and can have a max per family per day and a max per family per week, which count grown-ups' chores too; tick **Ask what it was** on an open-ended chore like Parent choice so kids must describe what they did), rates, reminder times, and interest. The Game card there explains how battles work and each mode (tap one), and the Levels card lists the XP for every level and what it unlocks.
- **Goal bonus** is 25% of the weekly goal, paid at cash-out when the week's earnings reach the goal.
- **Forgot to check something off?** In **Activity**, tap **It was done** next to it under Missed yesterday, or use **Fix a missed day** to fill in any day from the last two weeks, for anyone (adults too). The streak comes back right away, and a streak freeze spent on that day is returned.
- **Streaks** count days when every daily item was checked off. Once a day is complete it stays complete, even if the list changes later that day.
- **Reminders** go out at each person's reminder times (Mountain time), listing only what's still unchecked. Nothing is sent if everything's done.
- **Interest** on Invest is added once a month at cash-out, rounded down to the nearest quarter. The kid's Invest card shows the exact amount coming.

## Levels, XP, and battles

Everyone (adults too) earns XP and levels up, like a video game. XP never costs money, and it never goes down. The one exception: when a parent reverses a chore, that chore's XP comes off too.

**After the first deploy with levels:** open the Parent screen > **Game** tab > **Count past chores**. This gives everyone XP for the chores, goals, streaks, and badges they already earned. It's safe to run more than once.

**Each adult's Google email:** in **Settings** > People, tick **Adult** and fill in the adult's Google email. That ties each parent's sign-in to their own profile for battles. A parent can confirm, check, or judge a battle they're in, too.

How XP works:

| Earn XP for | XP |
|---|---|
| A family chore | 10 × the chore's pay multiplier (the same for everyone, whatever their rate) |
| Chore of the Day | Double. It rotates daily; change today's pick in the Game tab |
| A 7+ day checklist streak | ×1.25 on all XP |
| Finishing the daily checklist | 5 |
| Streak milestones (3, 7, 14, 30, 60, 100 days) | 25 to 400 |
| Weekly goal reached / deduction earned back / savings goal bought / new badge | 50 / 20 / 50 / 10 |
| Battles | 15 for a win, 10 for a tie, 5 for trying; Streak Duel and Goal Showdown pay double; a Boss Raid win pays 25 and a Baby Boss Raid win 10 |

What levels unlock: new creatures (the first 13 stay free), accessories, screen themes, goal-trail styles, confetti styles, titles, battle modes, and **streak freezes**. Freezes come every 5 levels, and you can hold 2. Just after midnight, a freeze covers anyone who missed yesterday's checklist. Creatures also grow as you level: they get a ring at level 5, a glow at 10, and an aura at 20.

**Battles** are opt-in challenges. You earn XP from them, never money:

| Mode | Unlocks at | How it works |
|---|---|---|
| Race | level 1 | First to finish N chores |
| Time Trial | level 1 | Same chore, fastest time done well. The timer's Done button logs the chore, and a parent checks the work |
| Ghost Race | level 1 | Beat your own best time, done well (a parent checks) |
| Blitz | level 3 | Most chore XP in a time window |
| Chore Bingo | level 5 | First to finish a row, column, or diagonal on a 3×3 card of chores |
| Territory | level 6 | Kids only. Most Anyone chores by midnight |
| Judge's Pick | level 8 | Same chore; a parent picks the better job in the Game tab |
| Streak Duel | level 10 | Whoever misses their daily list first loses (up to 14 days) |
| Goal Showdown | level 12 | Best share of the weekly goal, decided at cash-out |
| Boss Raid | level 15 | Team up (2 to 4 people) and beat a boss with chores |
| Baby Boss Raid | level 1 | A tiny one-day boss for younger kids or a quick team-up. Go solo or bring up to 3 teammates. Easy to beat, and it never gets harder |
| Kids vs. Grown-ups | level 15 | Team battle; the kids' team gets a handicap |
| Wildcard | level 20 | A random mode, often with a twist like "Clean bathroom counts double" |

**Time limits:** when starting a same-day battle (Race, Blitz, Territory, Bingo, Baby Boss Raid, Kids vs. Grown-ups, Time Trial, Ghost Race, Judge's Pick), pick how long it runs: until midnight, 15 minutes to 2 hours, or a custom number of minutes (5 to 240). Parents set each mode's default under Settings > Game.

Younger players get an automatic handicap: their score is multiplied by 8% per year of age difference, up to ×1.5. Adults count as 18. In Bingo the younger player gets free squares instead.

**Time Trial and Ghost Race need a parent's quality check.** When a kid finishes a timed run, the result is only pending. In the **Game** tab a parent marks each run **✓ Done well** or **✗ Not good enough** (you can check each run as soon as it's finished). Only runs done well count, so the fastest run done well wins, and a run that fails the check earns no XP. Unchecked runs become no contest after 48 hours.

Other speed results are final once someone on the other side or a parent confirms them, or on their own after 12 hours. Disputed results wait for a parent in the **Game** tab. Streak Duel, Goal Showdown, and Boss Raid are decided from the family's records and need no confirming.

To limit battles, go to **Settings** > Game. You can set quiet hours (no battles from 8:30 PM to 7 AM by default), how many battles each person can join per day (3) and per week (no limit by default), and open any mode to give it its own per-day or per-week limit, like chore limits. Declined, expired, and called-off battles don't count. You can also turn off single modes or battles entirely.

**More ways to play:**

- **Morning badges:** Early bird for 3 chores before 9 AM in one day, Rise and shine for 5 in one day, and Morning person for 25 chores before 9 AM in all. Like every badge, each pays 10 XP once.
- **Chore icons:** every chore shows an icon picked from its name (🧹 sweep, 🍽️ dishes, 🧺 laundry…). To change one, open the chore in Settings and tap an icon or type any emoji.
- **Weekly quests:** everyone gets 3 quests each Monday, like "Do 3 different chores in one day" or "Do a chore before 9 AM". They pay 15 to 25 XP and are checked automatically. You can turn them off in Settings > Game.
- **Rewards:** in Settings > Game, list real-world rewards by level (for example level 5: pick Friday dinner, again every 5 levels). Kids claim them from their screen, and you approve them and mark them given in the Game tab.
- **Bounties:** in the Game tab, post a one-off job worth extra XP ("Clean out the garage together, 200 XP"), for anyone or one person. A kid taps "I did it" and you award the XP.
- **Family goal:** in the Game tab, set a shared reward ("Pizza night") and how much XP the whole family needs to earn together. The bar shows on every screen and the family display, and celebrates when it fills.
- **Raises (off by default):** in Settings > Game you can have the Game tab suggest a per-chore raise every few levels. Nothing changes until you tap Give raise.
- **Notifications:** on a kid's tablet, tap "Turn on notifications" for chore reminders and battle news: new challenges, accepted or declined, results with XP earned, and expired challenges. On a parent's phone, tap "Notify this phone" in the Game tab for anything that needs a parent (claims, bounties, checks, judging) and, if your email is on your adult profile, your own battles. A switch there also sends you every kids' battle as it starts and finishes.

## Developing and testing

The game rules live in `public/game.js`. The functions use an identical copy at `functions/game.mjs`, so after editing the rules run `npm run sync`.

```
npm ci && npm ci --prefix functions
npm run hooks             # once per clone: git refuses a push when the fast checks fail
npm test                  # game rules (fast, no emulators)
npm run test:emulators    # functions + security rules against the Firebase emulators (needs Java 21)
```

GitHub runs both on every pull request and before every deploy. A failing test blocks the deploy.

To click around locally, run `npx firebase emulators:start --project demo-boon` and open http://127.0.0.1:5002. On localhost, the app talks to the emulators instead of your real data.

## Troubleshooting

- **"This Google account isn't on this family's parent list."** The email isn't in `functions/.env`, or you haven't redeployed since adding it.
- **A tablet shows the pairing screen again.** It was unpaired, or the browser's data was cleared. Make a new code and pair it again.
- **No reminders.** Check that the tablet shows "Reminders on" under Devices in Settings, that notifications for Chrome and the app are allowed in Android settings, and that the reminder time has passed while something was still unchecked.
- **Deploy error about billing or APIs.** Confirm the project is on Blaze, then run `firebase deploy` again.
- **First deploy with levels fails with an Eventarc or "service agent" permission error.** XP is awarded by functions that react to database changes, and those use Google's Eventarc service. On a project's first such deploy, Google sometimes needs a few minutes to set up permissions. Wait 5 minutes and deploy again (in GitHub: Actions > Deploy to Firebase > **Re-run jobs**). If it says an API must be enabled, enable it in the Google Cloud console (APIs & Services) and re-run.
- **See server logs:** Firebase console > Functions > pick a function > **Logs**.

## Notes

- Chore payments are calculated on the server, so a tablet can't change amounts or go past daily or weekly limits. Kid tablets can't change balances, deductions, or cash-outs.
- Data from the claude.ai prototype doesn't carry over; this starts fresh.
