import { request } from "node:http";
import { guarded } from "../guard.mjs";
import { check, list, mkt, num, pick, same, text } from "../marketing.mjs";
import { collect, collected, createSite, custom, eventually, pageview } from "../site.mjs";
import { rows } from "../store.mjs";
import { declare } from "./parts/funnels-helpers.mjs";
import { journeys as browser } from "./parts/websites-ui.mjs";

/** @typedef {import("../marketing.mjs").Ctx} Ctx */

/**
 * @param {Ctx} ctx The journey
 * @param {string} id The website
 * @returns {Promise<Record<string, unknown> | undefined>} Its row in the list
 */
async function listed(ctx, id) {
  const all = await mkt(ctx, "list the websites", "GET", "/websites");
  return list(all.body).find((entry) => entry._id === id);
}

/**
 * Posts a batch the way a script does, with no `Sec-Fetch-Mode` (fetch always adds one).
 *
 * @param {Ctx} ctx The journey
 * @param {string} origin The Origin header
 * @param {unknown} body The envelope
 * @returns {Promise<number | undefined>} The status
 */
function postWithoutFetchMetadata(ctx, origin, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(`${ctx.state.apiUrl}/api/marketing/collect`);
    const call = request({ hostname: target.hostname, port: target.port, path: target.pathname, method: "POST", headers: { origin, "user-agent": "Mozilla/5.0 Chrome/130", "content-type": "text/plain" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    call.on("error", reject);
    call.end(JSON.stringify(body));
  });
}

/** Websites: registration, rules, state, purges and deletion (4.usage/7.websites.md, 7.architecture/3.http-api.md). */
export const journeys = guarded([
  ...browser,
  {
    id: "a-website-is-registered-with-normalised-hosts",
    title: "a website keeps a name of up to 100 characters, stores bare lowercase hosts, takes localhost and addresses, and starts with tracking on and snapshots off",
    entryPoint: "POST /api/marketing/websites",
    async run(/** @type {Ctx} */ ctx) {
      const plain = await createSite(ctx, { name: "Plain", domain: "plain.example.com" });
      const row = await listed(ctx, plain.id);
      await ctx.verify("the defaults", [same("tracking on, snapshots off, text not masked, no extra hosts", [row?.trackingEnabled, row?.snapshotsEnabled, row?.snapshotMaskText, row?.extraDomains], [true, false, false, []])]);
      const hundred = await mkt(ctx, "a name of 100 characters", "POST", "/websites", { body: { name: "n".repeat(100), domain: "hundred.example.com" } });
      const over = await mkt(ctx, "a name of 101 characters", "POST", "/websites", { body: { name: "n".repeat(101), domain: "over.example.com" } });
      const blank = await mkt(ctx, "an empty name", "POST", "/websites", { body: { name: "", domain: "blank.example.com" } });
      await ctx.verify("the name", [same("100 characters", hundred.status, 200), same("101 characters", over.status, 400), same("empty", blank.status, 400)]);
      const messy = await mkt(ctx, "a domain with a scheme, a path and capitals", "POST", "/websites", { body: { name: "Messy", domain: "https://Shop.Example.com/x?y=1", extraDomains: ["HTTP://Staging.Example.com:8080/a", " plain-spaces.example.org "] } });
      await ctx.verify("hosts are stored bare and lowercase", [
        same("status", messy.status, 200),
        same("domain", text(messy.body, "domain"), "shop.example.com"),
        same("extra hosts", pick(messy.body, "extraDomains"), ["staging.example.com", "plain-spaces.example.org"]),
      ]);
      const local = await mkt(ctx, "localhost", "POST", "/websites", { body: { name: "Local", domain: "localhost" } });
      const address = await mkt(ctx, "an IP address", "POST", "/websites", { body: { name: "Address", domain: "192.0.2.10" } });
      const invalid = await mkt(ctx, "something that is not a host", "POST", "/websites", { body: { name: "Bad", domain: "not a host!" } });
      const missing = await mkt(ctx, "no domain", "POST", "/websites", { body: { name: "Bad" } });
      await ctx.verify("which values are hosts", [
        same("localhost", local.status, 200),
        same("an IP address", address.status, 200),
        same("not a host: 400 naming the field", [invalid.status, JSON.stringify(invalid.body).includes("domain")], [400, true]),
        same("no domain", missing.status, 400),
      ]);
      const twenty = Array.from({ length: 20 }, (_, index) => `extra${index}.example.net`);
      const atCap = await mkt(ctx, "20 extra hosts", "POST", "/websites", { body: { name: "Twenty", domain: "twenty.example.com", extraDomains: twenty } });
      const pastCap = await mkt(ctx, "21 extra hosts", "POST", "/websites", { body: { name: "TwentyOne", domain: "twentyone.example.com", extraDomains: [...twenty.map((host) => `x${host}`), "one-more.example.net"] } });
      await ctx.verify("up to 20 extra hosts", [same("20", atCap.status, 200), same("21", pastCap.status, 400)]);
    },
  },
  {
    id: "a-host-belongs-to-one-website-of-the-workspace",
    title: "a domain or an extra host another website already declares is a 409 with the field, in both directions, on create and on update",
    entryPoint: "POST /api/marketing/websites, PUT /api/marketing/websites/:id",
    async run(/** @type {Ctx} */ ctx) {
      const first = await createSite(ctx, { name: "First", domain: "first.example.com", extraDomains: ["alias.example.com"] });
      const sameDomain = await mkt(ctx, "the same domain", "POST", "/websites", { body: { name: "Second", domain: "first.example.com" } });
      const asExtra = await mkt(ctx, "a domain that is another site's extra host", "POST", "/websites", { body: { name: "Third", domain: "alias.example.com" } });
      const extraIsDomain = await mkt(ctx, "an extra host that is another site's domain", "POST", "/websites", { body: { name: "Fourth", domain: "fourth.example.com", extraDomains: ["first.example.com"] } });
      await ctx.verify("a host is declared once", [
        same("same domain", [sameDomain.status, text(sameDomain.body, "field")], [409, "domain"]),
        same("a domain that is an extra host", asExtra.status, 409),
        same("an extra host that is a domain", [extraIsDomain.status, text(extraIsDomain.body, "field").startsWith("extraDomains")], [409, true]),
        check("the answer carries the message and the values", Array.isArray(pick(sameDomain.body, "values")) && text(sameDomain.body, "message") !== "", sameDomain.body),
      ]);
      const other = await createSite(ctx, { name: "Other", domain: "other.example.com" });
      const update = await mkt(ctx, "move Other onto First's domain", "PUT", `/websites/${other.id}`, { body: { domain: "first.example.com" } });
      const keep = await mkt(ctx, "rename First keeping its own hosts", "PUT", `/websites/${first.id}`, { body: { name: "First renamed" } });
      await ctx.verify("the check also runs on update and ignores the website itself", [same("update onto a taken domain", update.status, 409), same("update that keeps its own hosts", keep.status, 200)]);
    },
  },
  {
    id: "an-update-changes-only-the-keys-it-carries",
    title: "PUT changes only the keys present, pauses with trackingEnabled false, and a website that does not exist is a 404",
    entryPoint: "PUT /api/marketing/websites/:id",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await createSite(ctx, { name: "Shop", domain: "update.example.com", extraDomains: ["keep.example.com"], snapshotMaskText: true });
      const renamed = await mkt(ctx, "rename only", "PUT", `/websites/${shop.id}`, { body: { name: "Shop 2" } });
      const row = await listed(ctx, shop.id);
      await ctx.verify("a key left out keeps its value", [same("name, domain, extra hosts, mask", [row?.name, row?.domain, row?.extraDomains, row?.snapshotMaskText], ["Shop 2", "update.example.com", ["keep.example.com"], true]), same("status", renamed.status, 200)]);
      await mkt(ctx, "pause", "PUT", `/websites/${shop.id}`, { body: { trackingEnabled: false } });
      const paused = await mkt(ctx, "read the context", "GET", "/context");
      const entry = list(paused.body, "websites").find((site) => site.id === shop.id);
      await ctx.verify("a paused site shows as paused", [same("state", entry?.state, "paused")]);
      await mkt(ctx, "resume", "PUT", `/websites/${shop.id}`, { body: { trackingEnabled: true } });
      const missing = await mkt(ctx, "update an unknown website", "PUT", "/websites/does-not-exist", { body: { name: "x" } });
      const missingDelete = await mkt(ctx, "delete an unknown website", "DELETE", "/websites/does-not-exist");
      await ctx.verify("an unknown website", [same("update", missing.status, 404), same("delete", missingDelete.status, 404)]);
    },
  },
  {
    id: "a-website-is-waiting-then-live-and-its-connection-is-readable",
    title: "a website waits for its first pageview, is live while its last event is under 5 minutes old, and the install guide's check reports its last visit",
    entryPoint: "GET /api/marketing/websites/:id/connection, GET /api/marketing/context",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await createSite(ctx);
      const before = await mkt(ctx, "connection before any visit", "GET", `/websites/${shop.id}/connection`);
      await ctx.verify("before the first visit", [same("state, visit, activity, refused hosts", [pick(before.body, "website", "state"), pick(before.body, "visit"), pick(before.body, "lastActivityAt"), pick(before.body, "rejected")], ["waiting", null, null, []])]);
      await collected(ctx, "the first pageview", shop, [pageview(shop, "/first")]);
      const after = await eventually(() => mkt(ctx, "connection after a visit", "GET", `/websites/${shop.id}/connection`), (answer) => pick(answer.body, "website", "state") === "live");
      await ctx.verify("after the first visit", [
        same("state", pick(after.body, "website", "state"), "live"),
        check("the last visit names the page and the browser", JSON.stringify(pick(after.body, "visit")).includes("/first") && JSON.stringify(pick(after.body, "visit")).includes("Chrome"), pick(after.body, "visit")),
        check("the last activity is recent", Math.abs(num(after.body, "lastActivityAt") - Date.now()) < 60_000, pick(after.body, "lastActivityAt")),
      ]);
    },
  },
  {
    id: "a-refused-browser-host-can-be-allowed-from-the-install-guide",
    title: "a host refused with a browser's headers is remembered (5 per site), Allow this host adds it to the extra hosts, and a hand-made request is not offered",
    entryPoint: "POST /api/marketing/collect, POST /api/marketing/websites/:id/allow-host",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await createSite(ctx);
      const event = pageview(shop, "/r");
      const browser = { "sec-fetch-mode": "cors" };
      await collect(ctx, "a refused browser host", shop, [event], { origin: "https://staging.partner.example.net", headers: browser });
      const handmade = await postWithoutFetchMetadata(ctx, "https://handmade.example.net", { website: shop.id, events: [event] });
      await collect(ctx, "a refused opaque origin", shop, [event], { origin: "null", headers: browser });
      const connection = await mkt(ctx, "read the refused hosts", "GET", `/websites/${shop.id}/connection`);
      const hosts = list(connection.body, "rejected").map((entry) => entry.hostname);
      await ctx.verify("only a browser's host is remembered", [same("the hand-made request is refused too", handmade, 403), same("refused hosts offered", hosts, ["staging.partner.example.net"])]);
      for (let index = 0; index < 6; index += 1) {
        await collect(ctx, `refused host ${index}`, shop, [event], { origin: `https://h${index}.example.net`, headers: browser });
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      const capped = await mkt(ctx, "read the refused hosts again", "GET", `/websites/${shop.id}/connection`);
      await ctx.verify("the memory keeps 5 hosts, the newest first", [same("hosts", list(capped.body, "rejected").map((entry) => entry.hostname), ["h5.example.net", "h4.example.net", "h3.example.net", "h2.example.net", "h1.example.net"])]);
      const allowed = await mkt(ctx, "allow a host", "POST", `/websites/${shop.id}/allow-host`, { body: { hostname: "h5.example.net" } });
      const after = await collect(ctx, "the allowed host sends a visit", shop, [event], { origin: "https://h5.example.net", headers: browser });
      const row = await listed(ctx, shop.id);
      const left = await mkt(ctx, "read the refused hosts after allowing", "GET", `/websites/${shop.id}/connection`);
      await ctx.verify("Allow this host", [
        same("answer", allowed.status, 200),
        same("it is an extra host", row?.extraDomains, ["h5.example.net"]),
        same("its visit is accepted", [after.status, after.accepted], [200, 1]),
        same("its refusals are forgotten, the others stay", list(left.body, "rejected").map((entry) => entry.hostname), ["h4.example.net", "h3.example.net", "h2.example.net", "h1.example.net"]),
      ]);
    },
  },
  {
    id: "purges-and-deletion-take-only-the-sites-own-data",
    title: "the counts, the heatmaps purge, the full purge (idempotent) and the deletion remove one site's rows and leave another site's intact",
    entryPoint: "GET /api/marketing/websites/:id/deletion, POST /api/marketing/websites/:id/purge, DELETE /api/marketing/websites/:id",
    async run(/** @type {Ctx} */ ctx) {
      const doomed = await createSite(ctx, { name: "Doomed" });
      const kept = await createSite(ctx, { name: "Kept" });
      for (const target of [doomed, kept]) {
        await collected(ctx, `data for ${target.name}`, target, [pageview(target, "/a"), custom(target, "/a", "signup"), { kind: "click", url: `https://${target.domain}/a`, data: { x: 0.5, y: 0.5 } }, { kind: "scroll", url: `https://${target.domain}/a`, data: { depth: 40 } }]);
      }
      await declare(ctx, doomed, { id: "doomed-funnel", steps: [{ kind: "url", value: "/a" }] });
      const counts = await mkt(ctx, "count what a purge discards", "GET", `/websites/${doomed.id}/deletion`);
      await ctx.verify("the deletion counts", [same("sessions, pageviews, heatmap events, snapshots, funnels", [num(counts.body, "sessions"), num(counts.body, "pageviews"), num(counts.body, "heatmapEvents"), num(counts.body, "snapshots"), num(counts.body, "funnels")], [1, 1, 2, 0, 1])]);
      const noScope = await mkt(ctx, "purge without a scope", "POST", `/websites/${doomed.id}/purge`, { body: {} });
      const badScope = await mkt(ctx, "purge with another scope", "POST", `/websites/${doomed.id}/purge`, { body: { scope: "everything" } });
      const heat = await mkt(ctx, "purge the heatmaps", "POST", `/websites/${doomed.id}/purge`, { body: { scope: "heatmaps" } });
      const afterHeat = await rows(ctx, "marketing_events", { websiteId: doomed.id });
      await ctx.verify("the heatmaps purge deletes clicks and scroll depths only", [
        same("a scope is required", [noScope.status, badScope.status], [400, 400]),
        same("answer", [heat.status, text(heat.body, "scope"), num(heat.body, "deleted", "events")], [200, "heatmaps", 2]),
        same("pageview and custom event stay", afterHeat.map((row) => row.kind).sort(), ["custom", "pageview"]),
      ]);
      const all = await mkt(ctx, "purge everything", "POST", `/websites/${doomed.id}/purge`, { body: { scope: "all" } });
      const again = await mkt(ctx, "purge everything again", "POST", `/websites/${doomed.id}/purge`, { body: { scope: "all" } });
      await ctx.verify("the full purge deletes events, sessions and rollups, and is idempotent", [
        same("first answer", [all.status, num(all.body, "deleted", "events"), num(all.body, "deleted", "sessions"), num(all.body, "deleted", "days")], [200, 2, 1, 1]),
        same("second answer", [again.status, num(again.body, "deleted", "events"), num(again.body, "deleted", "sessions"), num(again.body, "deleted", "days")], [200, 0, 0, 0]),
        same("the site stays", (await listed(ctx, doomed.id))?.name, "Doomed"),
        same("its funnels stay", pick(await mkt(ctx, "read the funnels list", "GET", `/funnels/rows?website=${doomed.id}`).then((answer) => answer.body), "total"), 1),
        same("no event or session of it is stored", [(await rows(ctx, "marketing_events", { websiteId: doomed.id })).length, (await rows(ctx, "marketing_sessions", { websiteId: doomed.id })).length], [0, 0]),
      ]);
      const removed = await mkt(ctx, "delete the website", "DELETE", `/websites/${doomed.id}`);
      const remaining = await mkt(ctx, "list the websites", "GET", "/websites");
      await ctx.verify("deleting removes the site and nothing else", [
        same("answer", removed.status, 200),
        same("the list", list(remaining.body).map((entry) => entry.name), ["Kept"]),
        same("the other site keeps its four events", (await rows(ctx, "marketing_events", { websiteId: kept.id })).length, 4),
        same("and its session", (await rows(ctx, "marketing_sessions", { websiteId: kept.id })).length, 1),
        same("a deleted site's beacons are refused", (await collect(ctx, "a beacon of the deleted site", doomed, [pageview(doomed, "/a")])).status, 404),
      ]);
    },
  },
]);
