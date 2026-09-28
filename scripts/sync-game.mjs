// Copies the shared game rules into the Cloud Functions folder.
// public/game.js is the source of truth; functions/game.mjs must stay identical (a unit test checks).
import { copyFileSync } from "node:fs";
copyFileSync(new URL("../public/game.js", import.meta.url), new URL("../functions/game.mjs", import.meta.url));
console.log("Copied public/game.js -> functions/game.mjs");
