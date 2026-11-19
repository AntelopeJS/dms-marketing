import { guarded } from "../guard.mjs";
import { journeys as ui } from "./parts/overview-ui.mjs";
import { journeys as live } from "./parts/overview-live.mjs";

/** The overview journeys that open a tab; `packages/dms-marketing/tests/overview.journeys.js` runs the others against the backend. */
export const journeys = guarded([...ui, ...live]);
