import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { WriteValue } from "@antelopejs/interface-database/common";
import {
  CORE_SCHEMA_NAME,
  DEFAULT_TENANT_ID,
  TENANT_SCHEMA_NAME,
} from "@antelopejs/interface-dms/constants";
import { Hook, RegisterHook } from "@antelopejs/interface-dms/hooks";
import { seedRollups } from "./demo-rollups";
import { DAY_MS, random, type Row, table, utcMidnight } from "./demo-shared";
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
const RAW_DAYS = 30;

interface Journey {
  steps: Array<[kind: string, value: string]>;
  variation?: string;
}

const HERO_ARMS = ["control", "bold-cta"];

/** A shop visit: lands, maybe adds to cart, maybe checks out. */
function shopJourney(rnd: () => number): Journey {
  const steps: Journey["steps"] = [];
  const pick = rnd();
  const landing =
    pick < 0.45 ? "/sale/office-chairs" : pick < 0.8 ? "/" : "/pricing/b2b";
  steps.push(["pageview", landing]);
  const variation =
    landing === "/" ? HERO_ARMS[rnd() < 0.5 ? 0 : 1] : undefined;
  if (landing === "/pricing/b2b") {
    if (rnd() < 0.31) steps.push(["custom", "quote_requested"]);
    return { steps };
  }
  if (landing === "/" && rnd() < 0.3)
    steps.push(["pageview", "/products/standing-desks"]);
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

interface Visit {
  sessionId: string;
  visitorId: string;
}

function anonymousVisit(): Visit {
  return { sessionId: randomUUID(), visitorId: randomUUID() };
}

function eventRow(
  { sessionId, visitorId }: Visit,
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

function journeyEvents(
  journey: Journey,
  start: number,
  rnd: () => number,
): Row[] {
  const visit = anonymousVisit();
  const rows: Row[] = [];
  let at = start;
  let url = journey.steps[0][1];
  if (journey.variation) {
    rows.push(
      eventRow(visit, at, "exposure", "/", {
        name: "hero-cta",
        data: { experiment: "hero-cta", variation: journey.variation },
      }),
    );
  }
  for (const [kind, value] of journey.steps) {
    at += Math.round(20_000 + rnd() * 90_000);
    if (kind === "pageview") {
      url = value;
      rows.push(eventRow(visit, at, "pageview", value));
    } else {
      rows.push(eventRow(visit, at, "custom", url, { name: value }));
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
      rows.push(
        eventRow(anonymousVisit(), at, "click", "/sale/office-chairs", {
          data: {
            x: 0.5,
            y: 0.2,
            selector,
            nth: 0,
            ox: 0.3 + rnd() * 0.4,
            oy: 0.3 + rnd() * 0.4,
          },
        }),
      );
    }
  }
  for (let index = 0; index < 600; index++) {
    const at = now - Math.round(rnd() * RAW_DAYS * DAY_MS);
    const depth = Math.round(
      Math.min(100, Math.max(0, 100 - Math.abs(rnd() * rnd()) * 140)),
    );
    rows.push(
      eventRow(anonymousVisit(), at, "scroll", "/sale/office-chairs", {
        data: { depth },
      }),
    );
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
  const events = table(
    TENANT_SCHEMA_NAME,
    "marketing_events",
    DEFAULT_TENANT_ID,
  );
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

function funnel(
  name: string,
  steps: Array<[string, string]>,
  windowHours: number,
  experiment: WriteValue = null,
): Row {
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
      funnel(
        "Autumn sale → order",
        [
          ["url", "/sale/office-chairs"],
          ["custom", "add_to_cart"],
          ["url", "/checkout"],
          ["custom", "checkout_completed"],
        ],
        24,
      ),
      funnel(
        "B2B quote request",
        [
          ["url", "/pricing/b2b"],
          ["custom", "quote_requested"],
        ],
        72,
      ),
      funnel(
        "Checkout",
        [
          ["custom", "add_to_cart"],
          ["url", "/checkout"],
          ["custom", "checkout_completed"],
        ],
        24,
      ),
      funnel(
        "Hero CTA test",
        [
          ["url", "/"],
          ["custom", "add_to_cart"],
        ],
        24,
        {
          key: "hero-cta",
          status: "running",
          variations: [
            { key: "control", weight: 1 },
            { key: "bold-cta", weight: 1 },
          ],
          runs: [{ startedAt, stoppedAt: null }],
        },
      ),
      funnel(
        "Footer signup form",
        [
          ["url", "/"],
          ["custom", "newsletter_subscribed"],
        ],
        24,
        {
          key: "footer-signup",
          status: "draft",
          variations: [
            { key: "control", weight: 1 },
            { key: "inline-form", weight: 1 },
          ],
          runs: [],
        },
      ),
    ])
    .run();
}

function website(
  id: string,
  name: string,
  domain: string,
  ageDays: number,
  extra: Partial<Row> = {},
): Row {
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
