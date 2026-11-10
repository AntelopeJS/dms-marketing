import { list, mkt, num, pick, same } from "../../marketing.mjs";
import { results, shop } from "./funnels-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */

const STEPS = [{ kind: "url", value: "/pricing" }];
const ARMS = [{ key: "a", weight: 1 }, { key: "b", weight: 1 }];

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }[]} */
export const journeys = [
  {
    id: "a-split-moves-draft-running-stopped-and-freezes-its-key-and-variations",
    title: "a split goes draft to running and between running and stopped, never back to draft; a stop closes a run and a resume opens the next; the key and the variations freeze once it leaves draft; it can be removed only as a draft; the name stays editable",
    entryPoint: "PUT /api/marketing/tables/funnels/edit",
    async run(ctx) {
      const site = await shop(ctx);
      const made = await mkt(ctx, "create a draft split", "POST", "/tables/funnels/new", { body: { websiteId: site.id, name: "Split", steps: STEPS, experiment: { key: "hero", variations: ARMS } } });
      const id = String(pick(made.body, "_id"));
      const edit = (/** @type {string} */ label, /** @type {Record<string, unknown>} */ body) => mkt(ctx, label, "PUT", `/tables/funnels/edit?id=${id}`, { body: { websiteId: site.id, name: "Split", steps: STEPS, ...body } });
      const state = async () => {
        const read = await results(ctx, site, id);
        return { status: pick(read.answer.body, "funnel", "experiment", "status"), runs: list(read.answer.body, "funnel", "experiment", "runs") };
      };
      const draft = await state();
      const retuned = await edit("change the variations of a draft", { experiment: { key: "hero2", variations: [{ key: "a", weight: 1 }, { key: "c", weight: 3 }] } });
      const stoppedFromDraft = await edit("stop a draft", { experiment: { key: "hero2", variations: [{ key: "a", weight: 1 }, { key: "c", weight: 3 }], status: "stopped" } });
      await ctx.verify("a draft", [same("status and runs", [draft.status, draft.runs.length], ["draft", 0]), same("key and variations are editable", retuned.status, 200), same("a draft cannot be stopped", stoppedFromDraft.status, 400)]);
      const start = await edit("start the test", { experiment: { key: "hero2", variations: [{ key: "a", weight: 1 }, { key: "c", weight: 3 }], status: "running" } });
      const running = await state();
      await ctx.verify("running", [same("start", start.status, 200), same("one open run", [running.status, running.runs.length, pick(running.runs[0], "stoppedAt")], ["running", 1, null])]);
      const frozenKey = await edit("change the key of a running split", { experiment: { key: "other", variations: [{ key: "a", weight: 1 }, { key: "c", weight: 3 }] } });
      const frozenWeights = await edit("change the weights of a running split", { experiment: { key: "hero2", variations: [{ key: "a", weight: 2 }, { key: "c", weight: 3 }] } });
      const toDraft = await edit("send a running split back to draft", { experiment: { key: "hero2", variations: [{ key: "a", weight: 1 }, { key: "c", weight: 3 }], status: "draft" } });
      const removed = await edit("remove the split of a running funnel", { experiment: null });
      const renamed = await mkt(ctx, "rename a running split's funnel", "PUT", `/tables/funnels/edit?id=${id}`, { body: { websiteId: site.id, name: "Renamed", steps: STEPS, experiment: { key: "hero2", variations: [{ key: "a", weight: 1 }, { key: "c", weight: 3 }] } } });
      await ctx.verify("a started split is frozen", [same("key", frozenKey.status, 400), same("weights", frozenWeights.status, 400), same("back to draft", toDraft.status, 400), same("remove", removed.status, 400), same("the name stays editable", renamed.status, 200)]);
      const stop = await edit("stop the test", { experiment: { key: "hero2", variations: [{ key: "a", weight: 1 }, { key: "c", weight: 3 }], status: "stopped" } });
      const stopped = await state();
      const resume = await edit("resume the test", { experiment: { key: "hero2", variations: [{ key: "a", weight: 1 }, { key: "c", weight: 3 }], status: "running" } });
      const resumed = await state();
      await ctx.verify("stop and resume", [
        same("stop closes the run", [stop.status, stopped.status, stopped.runs.length, num(stopped.runs[0], "stoppedAt") > 0], [200, "stopped", 1, true]),
        same("resume opens a second run", [resume.status, resumed.status, resumed.runs.length, pick(resumed.runs[1], "stoppedAt")], [200, "running", 2, null]),
      ]);
      const draftSplit = await mkt(ctx, "create another draft split", "POST", "/tables/funnels/new", { body: { websiteId: site.id, name: "Second", steps: STEPS, experiment: { key: "second", variations: ARMS } } });
      const removedDraft = await mkt(ctx, "remove the split of a draft", "PUT", `/tables/funnels/edit?id=${String(pick(draftSplit.body, "_id"))}`, { body: { websiteId: site.id, name: "Second", steps: STEPS, experiment: null } });
      const duplicate = await mkt(ctx, "reuse a key on the same website", "POST", "/tables/funnels/new", { body: { websiteId: site.id, name: "Third", steps: STEPS, experiment: { key: "hero2", variations: ARMS } } });
      await ctx.verify("a draft's split can be removed; a key is unique per website", [same("removed", removedDraft.status, 200), same("duplicate key", duplicate.status, 400)]);
    },
  },
];
