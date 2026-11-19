import { guarded } from "../guard.mjs";
import { journeys as ui } from "./parts/funnels-ui.mjs";

/** The funnels journeys that open a tab; `packages/dms-marketing/tests/funnels.journeys.js` runs the others against the backend. */
export const journeys = guarded([...ui]);
