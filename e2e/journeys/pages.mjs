import { guarded } from "../guard.mjs";
import { journeys as ui } from "./parts/pages-ui.mjs";

/** The pages journeys that open a tab; `packages/dms-marketing/tests/pages.journeys.test.js` runs the others against the backend. */
export const journeys = guarded([...ui]);
