import { guarded } from "../guard.mjs";
import { journeys as browser } from "./parts/websites-ui.mjs";

/** The websites journeys that open a tab; `packages/dms-marketing/tests/websites.journeys.test.js` runs the others against the backend. */
export const journeys = guarded([...browser]);
