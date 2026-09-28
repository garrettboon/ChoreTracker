# Boon Chore Tracker: Firebase setup

This folder is the complete app. You'll create a Firebase project, fill in three small settings, and deploy with one command. Plan on about 45 minutes the first time.

## What's in here

| Path | What it is |
|---|---|
| `public/` | The app itself (what the tablets load) |
| `public/config.js` | **You edit:** your Web Push key |
| `functions/index.js` | Server code: device pairing, chore logging, push reminders |
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
3. Your lane as Dad is its own tab at the start of the Parent screen.

## 7. Pair each tablet

Repeat for each kid's tablet and the leaderboard device:

1. On your phone: **Devices** tab > choose who the device is for > **Create pairing code**. Codes last 15 minutes.
2. On the tablet: open the Hosting URL in Chrome, open Chrome's menu, and tap **Add to Home screen** (or **Install app**). Open Boon Chores from the new home-screen icon.
3. Tap **Pair this device**, enter the code, and give the device a name.
4. On a kid's tablet, tap **Turn on chore reminders** and allow notifications. The Devices tab on your phone will show "Reminders on."

For the leaderboard device, keep it plugged in. The app asks the screen to stay awake while it's open; if it still dims, turn on **Stay awake** in Android's Developer options (it keeps the screen on while charging).

## Everyday use

- **Kids** tap chores, check off their daily list, set their goal after Sunday cash-out, split the week's savings between their goals, and choose where their bonus and interest go.
- **Parents** use **Activity** to review and reverse chores, or log one for someone without their tablet; **Leaderboard** to see the family board on a phone; **Kid views** to open any kid's screen exactly as they see it; **Deductions** to add, mark earned back, or remove; **Cash-out** on Sunday night; **Savings goals** to add or edit goals, log purchases, or set a child's balances (for money from before the app, or to fix a mistake); **Devices** to pair or unpair; and **Settings** for people, chores (drag the ⠿ handle to reorder them), rates, reminder times, and interest.
- **Streaks** count days when every daily item was checked off. Once a day is complete it stays complete, even if the list changes later that day.
- **Reminders** go out at each person's reminder times (Mountain time), listing only what's still unchecked. Nothing is sent if everything's done.

## Troubleshooting

- **"This Google account isn't on this family's parent list."** The email isn't in `functions/.env`, or you haven't redeployed since adding it.
- **A tablet shows the pairing screen again.** It was unpaired, or the browser's data was cleared. Make a new code and pair it again.
- **No reminders.** Check that the tablet shows "Reminders on" in Devices, that notifications for Chrome and the app are allowed in Android settings, and that the reminder time has passed while something was still unchecked.
- **Deploy error about billing or APIs.** Confirm the project is on Blaze, then run `firebase deploy` again.
- **See server logs:** Firebase console > Functions > pick a function > **Logs**.

## Notes

- Chore payments are calculated on the server, so a tablet can't change amounts or go past daily limits. Kid tablets can't change balances, deductions, or cash-outs.
- Data from the claude.ai prototype doesn't carry over; this starts fresh.
