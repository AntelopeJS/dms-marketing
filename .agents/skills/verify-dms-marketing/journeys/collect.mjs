import { guarded } from "../guard.mjs";
import { journeys as part1 } from "./parts/collect-1.mjs";
import { journeys as part2 } from "./parts/collect-2.mjs";
import { journeys as part3 } from "./parts/collect-3.mjs";
import { journeys as defaults } from "./parts/collect-default.mjs";

export const journeys = guarded([...part1, ...part2, ...part3, ...defaults]);
