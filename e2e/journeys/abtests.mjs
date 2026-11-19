import { guarded } from "../guard.mjs";
import { journeys as ui } from "./parts/abtests-ui.mjs";

/** The abtests journeys that open a tab; `packages/dms-marketing/tests/abtests.journeys.test.js` runs the others against the backend. */
export const journeys = guarded([...ui]);
