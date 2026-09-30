# Working on Boon Chore Tracker

Every push to `main` or a `claude/` branch deploys the family's live app once the test job passes, then moves `main` to the deployed commit. Treat every push as a release.

## Before you push

- `npm test` must pass. Run `npm run hooks` once per clone so git refuses a push when the fast checks fail.
- `functions/game.mjs` must be an exact copy of `public/game.js`. After editing the rules, run `npm run sync`.
- The emulator tests (`npm run test:emulators`) need Java 21 and the Firebase emulators, so they usually cannot run in a cloud session. They do run in the deploy job. When you change server behavior or any XP value, open `tests/emulator/*.test.mjs`, find the flow you touched, and update it by hand before pushing.
- Write test expectations in terms of the constants (`G.XP.*`, `G.levelFor`, `G.raidHp`, quest `xp`), never as literal numbers, so retuning a value cannot break a test that still describes correct behavior.

## When a deploy fails

- "Check that this commit includes what is live now" failed: another session deployed first. Merge `origin/main` into your branch, rerun the checks, and push again.
- The test job failed: read the failed job's log, fix the cause, and push. Never skip or loosen a test to get green.

## Where things live

- Game rules and constants (XP values, level curve, battle modes, creatures, quests): `public/game.js`.
- Creature unlock levels are also listed in `firestore.rules`; a unit test keeps the two in sync.
- The app is `public/app.js` and `public/index.html`; the server is `functions/index.js`.
