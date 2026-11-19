import { guarded } from "../guard.mjs";
import { journeys as browser } from "./parts/snapshots-browser.mjs";

/** The snapshots journeys that open a tab; `packages/dms-marketing/tests/snapshots.journeys.test.js` runs the others against the backend. */
export const journeys = guarded([...browser]);
