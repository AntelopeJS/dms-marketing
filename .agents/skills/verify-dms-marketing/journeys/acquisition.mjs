import { guarded } from "../guard.mjs";
import { check, list, mkt, num, pick, same } from "../marketing.mjs";
import { eventually, overview } from "../site.mjs";
import { campaigns, channels, channelsBlock, shop, visit } from "./parts/acquisition-helpers.mjs";

/** @typedef {import("../marketing.mjs").Ctx} Ctx */

/**
 * One journey per channel: every documented rule that makes a session that channel, each a visitor of its own;
 * the whole split must be exactly the channel (a rule that moves one session elsewhere shows).
 *
 * @param {string} id The journey id
 * @param {string} channel The channel
 * @param {import("./parts/acquisition-helpers.mjs").Visit[]} visits The sessions
 * @param {string} title What the rules are
 */
function rules(id, channel, visits, title) {
  return {
    id,
    title,
    entryPoint: "POST /api/marketing/collect, GET /api/marketing/blocks/channels",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await visit(ctx, site, visits);
      const split = await channels(ctx, site, visits.length);
      const block = await eventually(() => channelsBlock(ctx, site), (answer) => num(answer.body, "total") === visits.length);
      await ctx.verify(`all ${visits.length} sessions are ${channel}`, [
        same("the rolled-up split", split, { [channel]: visits.length }),
        same("the channels card counts them", list(block.body, "items").find((item) => item.id === channel)?.sessions, visits.length),
        same("the card lists all six channels, zero ones included", list(block.body, "items").map((item) => item.id).sort(), ["direct", "email", "organic", "paid", "referral", "social"]),
      ]);
    },
  };
}

const medium = (/** @type {string} */ value) => ({ query: `?utm_medium=${encodeURIComponent(value)}` });

/** Acquisition: how a session gets its channel, the campaigns table and the lists (4.usage/2.acquisition.md). */
export const journeys = guarded([
  rules("paid-mediums-and-ad-click-ids", "paid", [
    ...["cpc", "ppc", "cpm", "cpv", "cpa", "cpp", "sem", "display", "banner", "retargeting", "paid-social", "paid_search", "paidmedia"].map(medium),
    ...["gclid", "gbraid", "wbraid", "dclid", "msclkid", "ttclid", "twclid", "li_fat_id"].map((param) => ({ query: `?${param}=abc123` })),
    { query: "?gclid=1", referrer: "https://www.google.com/" },
    { query: "?utm_medium=cpc", referrer: "https://www.facebook.com/" },
  ], "a paid medium, a paid prefix or an ad click id makes a session Paid, even when the referrer is a search engine or a social network"),
  rules("email-mediums", "email", [...["email", "e-mail", "e_mail", "newsletter", "mail"].map(medium), { query: "?utm_medium=email", referrer: "https://mail.google.com/" }, { query: "?utm_medium=Email%20" }], "the email mediums make a session Email, whatever the referrer, and a medium is trimmed and lower-cased"),
  rules("social-networks-and-mediums", "social", [
    ...["social", "social-media", "sm"].map(medium),
    ...["facebook.com", "www.instagram.com", "twitter.com", "linkedin.com", "reddit.com", "out.reddit.com", "tiktok.com", "youtube.com", "m.youtube.com", "t.co", "x.com", "l.facebook.com"].map((host) => ({ referrer: `https://${host}/post/1` })),
    { query: "?fbclid=abc" },
    { query: "?igshid=abc" },
  ], "a social medium, a known social network (shorteners and mobile hosts included) or fbclid and igshid make a session Social"),
  rules("organic-search-engines", "organic", [
    medium("organic"),
    ...["google.com", "www.google.co.uk", "bing.com", "duckduckgo.com", "search.yahoo.com", "baidu.com", "yandex.ru"].map((host) => ({ referrer: `https://${host}/search?q=x` })),
  ], "the organic medium or a known search engine (by domain labels, so google.co.uk matches) makes a session Organic search"),
  rules("referral-and-direct", "referral", [
    { referrer: "https://blog.partner.example.org/post" },
    { referrer: "https://mail.google.com/mail/u/0/" },
    { referrer: "https://docs.google.com/document/d/1" },
    ...["referral", "affiliate", "partner"].map(medium),
    { query: "?utm_medium=partner", referrer: "https://blog.partner.example.org/" },
    { query: "?utm_medium=mystery", referrer: "https://blog.partner.example.org/" },
  ], "any other external referrer, mail.google.com and docs.google.com, the referral mediums with or without a referrer, and an unknown medium with a referrer make a session Referral"),
  rules("no-referrer-is-direct", "direct", [{}, { query: "?utm_medium=mystery" }, { query: "?utm_source=only-a-source" }], "no referrer and no matching rule, an unknown medium without a referrer and a source alone make a session Direct"),
  {
    id: "the-first-matching-rule-wins",
    title: "an ad click id beats an email medium, which beats a social referrer; a social medium beats a search referrer; an organic medium beats a referral referrer",
    entryPoint: "POST /api/marketing/collect, GET /api/marketing/blocks/channels",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await visit(ctx, site, [
        { query: "?gclid=1&utm_medium=email" },
        { query: "?utm_medium=email", referrer: "https://www.facebook.com/" },
        { query: "?utm_medium=social", referrer: "https://www.google.com/" },
        { query: "?utm_medium=organic", referrer: "https://blog.partner.example.org/" },
        { query: "?fbclid=1", referrer: "https://www.google.com/" },
      ]);
      const split = await channels(ctx, site, 5);
      await ctx.verify("the order paid, email, social, organic, referral, direct", [same("split", split, { paid: 1, email: 1, social: 2, organic: 1 })]);
    },
  },
  {
    id: "the-campaigns-table-groups-by-triple-and-channel",
    title: "campaign rows are source, medium, campaign and channel; values are trimmed, source and medium lower-cased, a missing parameter reads not set, the table searches, filters, ranks and pages 25 rows",
    entryPoint: "GET /api/marketing/blocks/campaigns/rows, GET /api/marketing/blocks/campaigns/notice",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await visit(ctx, site, [
        { query: "?utm_source=Newsletter&utm_medium=Email&utm_campaign=Spring%20Sale" },
        { query: "?utm_source=newsletter%20&utm_medium=email%20&utm_campaign=Spring%20Sale" },
        { query: "?utm_source=newsletter" },
        { query: "?utm_source=facebook&utm_medium=cpc&utm_campaign=ads" },
        { query: "?utm_source=facebook&utm_campaign=app" },
        { query: "?utm_source=facebook&utm_campaign=app", referrer: "https://www.facebook.com/" },
      ]);
      await eventually(() => overview(ctx, site), (answer) => num(answer.body, "totals", "sessions") === 6);
      const all = await campaigns(ctx, site);
      const key = (/** @type {Record<string, unknown>} */ row) => `${row.source}|${row.medium}|${row.campaign}|${row.channel}`;
      const byKey = Object.fromEntries(all.rows.map((row) => [key(row), row.sessions]));
      await ctx.verify("the rows", [
        same("one row per triple and channel, normalised", byKey, { "newsletter|email|Spring Sale|email": 2, "newsletter|null|null|direct": 1, "facebook|cpc|ads|paid": 1, "facebook|null|app|direct": 1, "facebook|null|app|social": 1 }),
        same("total", all.total, 5),
        same("the biggest row first", key(all.rows[0] ?? {}), "newsletter|email|Spring Sale|email"),
        same("the share of the period's sessions", pick(all.rows[0], "share", "params", "value", "value"), 33.3),
        same("a row without a medium is flagged", all.rows.filter((row) => row.missingMedium === true).map(key).sort(), ["facebook|null|app|direct", "facebook|null|app|social", "newsletter|null|null|direct"]),
      ]);
      const search = await campaigns(ctx, site, "&limit=25&search=spring");
      const social = await campaigns(ctx, site, "&limit=25&filter_channel=is:social");
      const paged = await campaigns(ctx, site, "&limit=2&offset=4");
      await ctx.verify("search, channel filter and paging", [
        same("search by campaign", search.rows.map(key), ["newsletter|email|Spring Sale|email"]),
        same("filter by channel", social.rows.map(key), ["facebook|null|app|social"]),
        same("a page holds its rows and total counts them all", [paged.rows.length, paged.total], [1, 5]),
      ]);
      const tagged = await mkt(ctx, "read the tagged notice", "GET", `/blocks/campaigns/notice?kind=tagged&website=${site.id}`);
      const missing = await mkt(ctx, "read the missing medium notice", "GET", `/blocks/campaigns/notice?kind=missing&website=${site.id}`);
      await ctx.verify("the notices", [
        same("tagged sessions and their share", [pick(tagged.body, "title", "params", "count", "value"), pick(tagged.body, "title", "params", "share", "params", "value", "value")], [6, 100]),
        same("sessions tagged without a medium", pick(missing.body, "title", "params", "count", "value"), 3),
      ]);
      const overviewRead = await overview(ctx, site);
      await ctx.verify("source and medium are lower-cased in the lists, the campaign is not", [
        same("sources", pick(overviewRead.body, "topUtmSources"), { newsletter: 3, facebook: 3 }),
        same("mediums", pick(overviewRead.body, "topUtmMediums"), { email: 2, cpc: 1 }),
        same("campaigns", pick(overviewRead.body, "topUtmCampaigns"), { "Spring Sale": 2, ads: 1, app: 2 }),
      ]);
    },
  },
  {
    id: "the-campaigns-table-pages-25-rows-at-a-time",
    title: "26 campaigns make 26 rows, 25 on a page and one on the next",
    entryPoint: "GET /api/marketing/blocks/campaigns/rows",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await visit(ctx, site, Array.from({ length: 26 }, (_, index) => ({ query: `?utm_source=src${index}&utm_medium=email&utm_campaign=c${index}` })));
      await eventually(() => overview(ctx, site), (answer) => num(answer.body, "totals", "sessions") === 26);
      const first = await campaigns(ctx, site, "&limit=25&offset=0");
      const second = await campaigns(ctx, site, "&limit=25&offset=25");
      await ctx.verify("paging", [same("first page, second page, total", [first.rows.length, second.rows.length, first.total], [25, 1, 26])]);
    },
  },
  {
    id: "referrers-and-the-lists-behind-the-campaigns",
    title: "top referrers count external domains on new sessions across channels (link shims count as their network), UTM contents and terms list the two parameters outside the triple, the site's own domain is no source",
    entryPoint: "GET /api/marketing/stats/overview, GET /api/marketing/blocks/tops",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await visit(ctx, site, [
        { referrer: "https://l.facebook.com/l.php?u=x" },
        { referrer: "https://www.facebook.com/" },
        { referrer: "https://m.youtube.com/watch" },
        { referrer: "https://blog.partner.example.org/post" },
        { referrer: `https://${site.domain}/home` },
        { query: "?utm_medium=cpc", referrer: "https://www.google.com/" },
        { query: "?utm_content=banner-a&utm_term=running%20shoes" },
        { query: "?utm_content=banner-a&utm_term=Running%20Shoes" },
      ]);
      const read = await eventually(() => overview(ctx, site), (answer) => num(answer.body, "totals", "sessions") === 8);
      await ctx.verify("the lists", [
        same("referrers: network, not shim, own domain left out, paid sessions included", pick(read.body, "topReferrers"), { "facebook.com": 2, "youtube.com": 1, "blog.partner.example.org": 1, "google.com": 1 }),
        same("utm contents", pick(read.body, "topUtmContents"), { "banner-a": 2 }),
        check("utm terms keep both spellings apart or together as documented (two sessions in total)", Object.values(/** @type {Record<string, number>} */ (pick(read.body, "topUtmTerms") ?? {})).reduce((a, b) => a + b, 0) === 2, pick(read.body, "topUtmTerms")),
      ]);
      const acquisitionTops = await mkt(ctx, "read the acquisition top-list card", "GET", `/blocks/tops?group=acquisition&website=${site.id}`);
      const tabs = list(acquisitionTops.body, "tabs");
      await ctx.verify("the acquisition card of the overview", [
        same("tabs", tabs.map((tab) => tab.id), ["channels", "campaigns", "referrers"]),
        same("the channels tab", list(tabs.find((tab) => tab.id === "channels"), "items").map((item) => [item.id, item.value]).sort(), [["direct", 3], ["paid", 1], ["referral", 1], ["social", 3]]),
      ]);
    },
  },
]);
