import { guarded } from "../guard.mjs";
import { journeys as ui } from "./parts/acquisition-ui.mjs";

/** The acquisition journeys that open a tab; `packages/dms-marketing/tests/acquisition.journeys.js` runs the others against the backend. */
export const journeys = guarded([...ui]);
