import { guarded } from "../guard.mjs";
import { journeys as ui } from "./parts/settings-ui.mjs";

/** The settings journeys that open a tab; `packages/dms-marketing/tests/settings.journeys.test.js` runs the others against the backend. */
export const journeys = guarded([...ui]);
