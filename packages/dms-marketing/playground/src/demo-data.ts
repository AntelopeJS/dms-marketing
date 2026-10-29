import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Schema } from "@antelopejs/interface-database";
import {
  CORE_SCHEMA_NAME,
  DEFAULT_TENANT_ID,
  TENANT_SCHEMA_NAME,
} from "@antelopejs/interface-dms/constants";
import { Hook, RegisterHook } from "@antelopejs/interface-dms/hooks";
import { SNAPSHOT_HTML } from "./demo-snapshot";

/**
 * A realistic dataset for the redesigned dashboards: three websites of the
 * default tenant (a busy shop, a quieter docs site, one still waiting for its
 * first pageview), 120 days of daily rollups, 30 days of raw events behind
 * funnels, an A/B test and a heatmap, and a snapshot to draw it on. Written
 * once, when DMS provisions the default tenant, straight into the tables,
 * because collect stamps events with the server clock and could never
 * backfill history.
 *
 * Set DMS_MARKETING_DEMO=0 to start the playground without it.
 */

const SHOP_ID = "acme-shop";
const DOCS_ID = "acme-docs";
const PORTAL_ID = "partners-portal";
const DAY_MS = 86_400_000;
const HISTORY_DAYS = 120;
const RAW_DAYS = 30;
const SEPARATOR = "\u001f";

// The demo writes rows of several tables through one helper, so it drops the
// row typing the decorated models would give it.
// oxlint-disable-next-line typescript/no-explicit-any
type Row = Record<string, any> & { _id: string };
interface Runnable {
  run(): Promise<unknown>;
}

/** The two calls the demo makes, on rows of any table. */
interface AnyTable {
  insert(rows: Row | Row[]): Runnable;
  get(id: string): Runnable;
}

function table(schema: string, name: string, instance?: string): AnyTable {
  const found = Schema.get(schema)?.instance(instance).table(name);
  if (!found) {
    throw new Error(`[playground] table ${name} is not registered`);
  }
  return found as AnyTable;
}

/** Deterministic: the same dataset on every fresh database. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function utcMidnight(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Split `total` over weighted keys, the rounding remainder on the first one. */
function spread(total: number, weights: Record<string, number>): Record<string, number> {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  let used = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const share = Math.floor((total * weight) / sum);
    if (share > 0) {
      out[key] = share;
      used += share;
    }
  }
  const first = Object.keys(weights)[0];
  out[first] = (out[first] ?? 0) + (total - used);
  return out;
}

const SHOP_PAGES = {
  "/": 20,
  "/sale/office-chairs": 13,
  "/products/standing-desks": 11,
  "/products/ergo-chair-graphite": 7,
  "/pricing/b2b": 6,
  "/cart": 5,
  "/checkout": 3,
  "/blog/desk-setup-guide": 3,
  "/about": 1.4,
  "/contact": 1.1,
  "/legal/terms": 0.2,
};

const SHOP_REFERRERS = {
  "google.com": 60,
  "linkedin.com": 10,
  "northwind.co": 3,
  "bing.com": 3,
  "duckduckgo.com": 1.3,
};

const SHOP_CAMPAIGNS: Record<string, number> = {
  [["newsletter", "email", "autumn-sale"].join(SEPARATOR)]: 0, // the spike
  [["linkedin", "social", "b2b-desks-q3"].join(SEPARATOR)]: 4.1,
  [["google", "cpc", "ergonomic-chairs"].join(SEPARATOR)]: 2.9,
  [["newsletter", "email", "weekly-digest"].join(SEPARATOR)]: 2.6,
  [["northwind", "referral", "co-marketing"].join(SEPARATOR)]: 1.4,
  [["google", "cpc", "standing-desks"].join(SEPARATOR)]: 1,
  [["newsletter", "", ""].join(SEPARATOR)]: 0.9,
  [["facebook", "paid-social", "retargeting-sep"].join(SEPARATOR)]: 0.6,
  [["globex", "referral", "partner-launch"].join(SEPARATOR)]: 0.3,
};

const SHOP_EVENTS = {
  add_to_cart: 44,
  quote_requested: 19,
  signup_submitted: 15,
  newsletter_subscribed: 12,
  checkout_completed: 9,
};

interface DayVolume {
  sessions: number;
  spike: number;
}

/** Weekly rhythm, a slow climb and the autumn newsletter eight days ago. */
function shopVolume(dayIndex: number, rnd: () => number): DayVolume {
  const daysAgo = HISTORY_DAYS - 1 - dayIndex;
  const weekday = new Date(utcMidnight(Date.now()) - daysAgo * DAY_MS).getUTCDay();
  const weekly = weekday === 0 || weekday === 6 ? 0.62 : 1;
  const trend = 1 + dayIndex / (HISTORY_DAYS * 4);
  const spike = daysAgo === 8 ? 520 : daysAgo === 7 ? 240 : daysAgo === 9 ? 80 : 0;
  const base = 410 * weekly * trend * (0.9 + rnd() * 0.2);
  return { sessions: Math.round(base + spike), spike };
}

/** The channel a demo campaign's sessions land in: its medium alone, as they carry no referrer. */
function mediumChannel(key: string): string {
  const medium = key.split(SEPARATOR)[1];
  if (medium === "cpc" || medium.startsWith("paid")) return "paid";
  if (medium === "email" || medium === "social" || medium === "referral") return medium;
  return "direct";
}

/** The channel an untagged session with this referrer lands in. */
function referrerChannel(domain: string): string {
  if (/google|bing|duckduckgo/.test(domain)) return "organic";
  return /linkedin|facebook/.test(domain) ? "social" : "referral";
}

/** Only the counted keys: a zero would still take a line in a top. */
function counted(map: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(map).filter(([, count]) => count > 0));
}

/**
 * Each session of a day in exactly one channel, so the channels add up to
 * the sessions: the tagged ones by their medium (they carry no referrer), the
 * untagged referred ones by their referrer, the rest Direct.
 */
function channelsOf(
  sessions: number,
  campaigns: Record<string, number>,
  referrers: Record<string, number>,
): Record<string, number> {
  const channels: Record<string, number> = { direct: sessions, paid: 0, email: 0, social: 0, referral: 0, organic: 0 };
  const take = (channel: string, count: number) => {
    channels[channel] += count;
    channels.direct -= count;
  };
  for (const [key, count] of Object.entries(campaigns)) {
    if (mediumChannel(key) !== "direct") take(mediumChannel(key), count);
  }
  for (const [domain, count] of Object.entries(referrers)) take(referrerChannel(domain), count);
  return counted(channels);
}

/** One UTM field of the tagged sessions, read off their campaign keys. */
function utmTop(campaigns: Record<string, number>, field: number): Record<string, number> {
  const top: Record<string, number> = {};
  for (const [key, count] of Object.entries(campaigns)) {
    const value = key.split(SEPARATOR)[field];
    if (value) top[value] = (top[value] ?? 0) + count;
  }
  return top;
}

function rollupRow(
  websiteId: string,
  day: number,
  sessions: number,
  spike: number,
  rnd: () => number,
  scale: number,
): Row {
  const pageviews = Math.round(sessions * (3.1 + rnd() * 0.3));
  const campaigns = { ...SHOP_CAMPAIGNS };
  campaigns[["newsletter", "email", "autumn-sale"].join(SEPARATOR)] = spike > 0 ? spike * 1.2 : 0.4;
  // The newsletter spike arrives tagged; referrers only reach the sessions
  // left, so tagged + referred never exceeds the day.
  const base = sessions - spike;
  const tagged = Math.min(sessions, Math.round(base * 0.27 + spike * 0.9));
  const taggedCampaigns = counted(spread(tagged, campaigns));
  const referrers = counted(spread(Math.min(sessions - tagged, Math.round(base * 0.45)), SHOP_REFERRERS));
  const channels = channelsOf(sessions, taggedCampaigns, referrers);
  const paidClicks = Object.entries(taggedCampaigns)
    .filter(([key]) => mediumChannel(key) === "paid")
    .reduce((sum, [, count]) => sum + count, 0);
  return {
    _id: `${websiteId}:${day}`,
    websiteId,
    day,
    pageviews,
    sessions,
    newVisitors: Math.round(sessions * 0.63),
    customEvents: Math.round(sessions * 0.21 * scale),
    bouncedSessions: Math.round(sessions * (0.39 + rnd() * 0.05)),
    sessionDurationMs: Math.round(sessions * (160 + rnd() * 20) * 1000),
    tops: {
      topPages: spread(pageviews, SHOP_PAGES),
      topEntryPages: spread(sessions, { "/": 40, "/sale/office-chairs": 30, "/products/standing-desks": 15, "/blog/desk-setup-guide": 9, "/pricing/b2b": 6 }),
      topExitPages: spread(sessions, { "/": 25, "/cart": 20, "/checkout": 18, "/sale/office-chairs": 22, "/pricing/b2b": 15 }),
      topReferrers: referrers,
      topUtmSources: utmTop(taggedCampaigns, 0),
      topUtmMediums: utmTop(taggedCampaigns, 1),
      topUtmCampaigns: utmTop(taggedCampaigns, 2),
      // Terms come with the paid search clicks, contents with any tagged link.
      topUtmTerms: counted(spread(Math.min(paidClicks, Math.round(sessions * 0.04)), { "ergonomic office chair": 49, "standing desk b2b": 26, "office chair bulk": 17, "cable tray desk": 8 })),
      topUtmContents: counted(spread(Math.min(tagged, Math.round(sessions * 0.15)), { "hero-button": 50, "product-grid": 24, "carousel-2": 15, "footer-link": 11 })),
      topCampaigns: Object.fromEntries(
        Object.entries(taggedCampaigns).map(([key, count]) => [`${key}${SEPARATOR}${mediumChannel(key)}`, count]),
      ),
      topChannels: channels,
      topDevices: spread(sessions, { desktop: 68, mobile: 27, tablet: 5 }),
      topBrowsers: spread(sessions, { Chrome: 61, Safari: 22, Firefox: 9, Edge: 8 }),
      topCountries: spread(sessions, { FR: 31, DE: 20, GB: 16, BE: 11, NL: 9, ES: 5 }),
      topLanguages: spread(sessions, { "fr-FR": 34, "de-DE": 21, "en-GB": 24, "nl-NL": 11, "es-ES": 5 }),
      topEvents: spread(Math.round(sessions * 0.21 * scale), SHOP_EVENTS),
    },
  };
}

async function seedRollups(websiteId: string, scale: number, seed: number): Promise<void> {
  const rnd = random(seed);
  const today = utcMidnight(Date.now());
  const rows: Row[] = [];
  for (let index = 0; index < HISTORY_DAYS; index++) {
    const day = today - (HISTORY_DAYS - 1 - index) * DAY_MS;
    const volume = shopVolume(index, rnd);
    rows.push(rollupRow(websiteId, day, Math.round(volume.sessions * scale), Math.round(volume.spike * scale), rnd, scale));
  }
  await table(TENANT_SCHEMA_NAME, "marketing_website_statistics", DEFAULT_TENANT_ID).insert(rows).run();
}

interface Journey {
  steps: Array<[kind: string, value: string]>;
  variation?: string;
}

const HERO_ARMS = ["control", "bold-cta"];

/** A shop visit: lands, maybe adds to cart, maybe checks out. */
function shopJourney(rnd: () => number): Journey {
  const steps: Journey["steps"] = [];
  const pick = rnd();
  const landing = pick < 0.45 ? "/sale/office-chairs" : pick < 0.8 ? "/" : "/pricing/b2b";
  steps.push(["pageview", landing]);
  const variation = landing === "/" ? HERO_ARMS[rnd() < 0.5 ? 0 : 1] : undefined;
  if (landing === "/pricing/b2b") {
    if (rnd() < 0.31) steps.push(["custom", "quote_requested"]);
    return { steps };
  }
  if (landing === "/" && rnd() < 0.3) steps.push(["pageview", "/products/standing-desks"]);
  const cartRate = variation === "bold-cta" ? 0.081 : variation ? 0.055 : 0.33;
  if (rnd() < cartRate) {
    steps.push(["custom", "add_to_cart"]);
    if (rnd() < 0.39) {
      steps.push(["pageview", "/checkout"]);
      if (rnd() < 0.29) steps.push(["custom", "checkout_completed"]);
    }
  }
  return { steps, variation };
}

function eventRow(
  sessionId: string,
  visitorId: string,
  at: number,
  kind: string,
  url: string,
  extra: Partial<Row> = {},
): Row {
  return {
    _id: randomUUID(),
    websiteId: SHOP_ID,
    timestamp: new Date(at),
    day: utcMidnight(at),
    kind,
    sessionId,
    visitorId,
    url,
    ...extra,
  };
}

function journeyEvents(journey: Journey, start: number, rnd: () => number): Row[] {
  const sessionId = randomUUID();
  const visitorId = randomUUID();
  const rows: Row[] = [];
  let at = start;
  let url = journey.steps[0][1];
  if (journey.variation) {
    rows.push(eventRow(sessionId, visitorId, at, "exposure", "/", { name: "hero-cta", data: { experiment: "hero-cta", variation: journey.variation } }));
  }
  for (const [kind, value] of journey.steps) {
    at += Math.round(20_000 + rnd() * 90_000);
    if (kind === "pageview") {
      url = value;
      rows.push(eventRow(sessionId, visitorId, at, "pageview", value));
    } else {
      rows.push(eventRow(sessionId, visitorId, at, "custom", url, { name: value }));
    }
  }
  return rows;
}

/** Clicks anchored on the elements of the snapshot below. */
const HOT_ELEMENTS: Array<[selector: string, weight: number]> = [
  ["main .hero a.btn-primary", 412],
  [".products li:nth-child(1) button", 286],
  ["header nav a.cart", 188],
  ["main .hero a.btn-ghost", 142],
  ["main .hero picture", 118],
  [".quote button", 64],
];

function clickEvents(now: number, rnd: () => number): Row[] {
  const rows: Row[] = [];
  for (const [selector, weight] of HOT_ELEMENTS) {
    for (let index = 0; index < weight; index++) {
      const at = now - Math.round(rnd() * RAW_DAYS * DAY_MS);
      rows.push(eventRow(randomUUID(), randomUUID(), at, "click", "/sale/office-chairs", {
        data: { x: 0.5, y: 0.2, selector, nth: 0, ox: 0.3 + rnd() * 0.4, oy: 0.3 + rnd() * 0.4 },
      }));
    }
  }
  for (let index = 0; index < 600; index++) {
    const at = now - Math.round(rnd() * RAW_DAYS * DAY_MS);
    const depth = Math.round(Math.min(100, Math.max(0, 100 - Math.abs(rnd() * rnd()) * 140)));
    rows.push(eventRow(randomUUID(), randomUUID(), at, "scroll", "/sale/office-chairs", { data: { depth } }));
  }
  return rows;
}

async function seedRawEvents(): Promise<void> {
  const rnd = random(7);
  const now = Date.now();
  const rows: Row[] = [];
  for (let index = 0; index < 9000; index++) {
    const start = now - Math.round(rnd() * RAW_DAYS * DAY_MS) - 5 * 60_000;
    rows.push(...journeyEvents(shopJourney(rnd), start, rnd));
  }
  rows.push(...clickEvents(now, rnd));
  const events = table(TENANT_SCHEMA_NAME, "marketing_events", DEFAULT_TENANT_ID);
  const BATCH = 2000;
  for (let index = 0; index < rows.length; index += BATCH) {
    await events.insert(rows.slice(index, index + BATCH)).run();
  }
}

async function seedSessions(): Promise<void> {
  const now = Date.now();
  const session = (websiteId: string, ageMs: number): Row => ({
    _id: randomUUID(),
    websiteId,
    visitorId: randomUUID(),
    startedAt: new Date(now - ageMs - 120_000),
    lastSeenAt: new Date(now - ageMs),
    isNewVisitor: true,
    entryUrl: "/",
    exitUrl: "/",
    pageviewsCount: 3,
    eventsCount: 1,
    browser: "Chrome",
    deviceType: "desktop",
  });
  await table(TENANT_SCHEMA_NAME, "marketing_sessions", DEFAULT_TENANT_ID)
    .insert([session(SHOP_ID, 12_000), session(DOCS_ID, 4 * 60_000)])
    .run();
}

async function seedSnapshot(): Promise<void> {
  const html = gzipSync(Buffer.from(SNAPSHOT_HTML, "utf8")).toString("base64");
  await table(TENANT_SCHEMA_NAME, "marketing_page_snapshots", DEFAULT_TENANT_ID)
    .insert({
      _id: `${SHOP_ID}-sale-desktop`,
      websiteId: SHOP_ID,
      url: "/sale/office-chairs",
      layout: "desktop",
      origin: "https://shop.acme.test",
      viewportWidth: 1280,
      viewportHeight: 800,
      documentWidth: 1280,
      documentHeight: 1100,
      colorScheme: "light",
      capturedAt: new Date(Date.now() - 2 * DAY_MS),
      bytes: SNAPSHOT_HTML.length,
      html,
    })
    .run();
}

function funnel(name: string, steps: Array<[string, string]>, windowHours: number, experiment: unknown = null): Row {
  return {
    _id: randomUUID(),
    websiteId: SHOP_ID,
    name,
    steps: steps.map(([kind, value]) => ({ kind, value })),
    conversionWindowMs: windowHours * 3_600_000,
    experiment,
    createdAt: new Date(Date.now() - 19 * DAY_MS),
    updatedAt: new Date(Date.now() - 19 * DAY_MS),
  };
}

async function seedFunnels(): Promise<void> {
  const startedAt = Date.now() - 21 * DAY_MS;
  await table(TENANT_SCHEMA_NAME, "marketing_funnels", DEFAULT_TENANT_ID)
    .insert([
      funnel("Autumn sale → order", [["url", "/sale/office-chairs"], ["custom", "add_to_cart"], ["url", "/checkout"], ["custom", "checkout_completed"]], 24),
      funnel("B2B quote request", [["url", "/pricing/b2b"], ["custom", "quote_requested"]], 72),
      funnel("Checkout", [["custom", "add_to_cart"], ["url", "/checkout"], ["custom", "checkout_completed"]], 24),
      funnel("Hero CTA test", [["url", "/"], ["custom", "add_to_cart"]], 24, {
        key: "hero-cta",
        status: "running",
        variations: [{ key: "control", weight: 1 }, { key: "bold-cta", weight: 1 }],
        runs: [{ startedAt, stoppedAt: null }],
      }),
      funnel("Footer signup form", [["url", "/"], ["custom", "newsletter_subscribed"]], 24, {
        key: "footer-signup",
        status: "draft",
        variations: [{ key: "control", weight: 1 }, { key: "inline-form", weight: 1 }],
        runs: [],
      }),
    ])
    .run();
}

function website(id: string, name: string, domain: string, ageDays: number, extra: Partial<Row> = {}): Row {
  const createdAt = new Date(Date.now() - ageDays * DAY_MS);
  return {
    _id: id,
    tenantId: DEFAULT_TENANT_ID,
    name,
    domain,
    extraDomains: [],
    trackingEnabled: true,
    snapshotsEnabled: false,
    snapshotMaskText: false,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  };
}

async function seedWebsites(): Promise<void> {
  await table(CORE_SCHEMA_NAME, "marketing_websites")
    .insert([
      website(SHOP_ID, "Acme shop", "shop.acme.test", 200, {
        extraDomains: ["staging.acme.test", "acme.eu"],
        snapshotsEnabled: true,
      }),
      website(DOCS_ID, "Acme docs", "docs.acme.test", 150),
      website(PORTAL_ID, "Partners portal", "partners.acme.test", 10),
    ])
    .run();
}

export function registerDemoData(): void {
  if (process.env.DMS_MARKETING_DEMO === "0") {
    return;
  }
  RegisterHook(Hook.TENANT_BEING_PROVISIONED, async ({ tenantId }) => {
    if (tenantId !== DEFAULT_TENANT_ID) {
      return undefined;
    }
    await seedWebsites();
    await seedRollups(SHOP_ID, 1, 11);
    await seedRollups(DOCS_ID, 0.21, 13);
    await seedRawEvents();
    await seedSessions();
    await seedSnapshot();
    await seedFunnels();
    return undefined;
  });
}
