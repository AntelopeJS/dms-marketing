import {
  DEFAULT_TENANT_ID,
  TENANT_SCHEMA_NAME,
} from "@antelopejs/interface-dms/constants";
import { DAY_MS, random, type Row, table, utcMidnight } from "./demo-shared";

const HISTORY_DAYS = 120;
const SEPARATOR = "\u001f";

/** Split `total` over weighted keys, the rounding remainder on the first one. */
function spread(total: number, weights: Readonly<Record<string, number>>) {
  const entries = Object.entries(weights);
  const sum = entries.reduce((acc, [, weight]) => acc + weight, 0);
  const out = new Map<string, number>();
  let used = 0;
  for (const [key, weight] of entries) {
    const share = Math.floor((total * weight) / sum);
    if (share > 0) {
      out.set(key, share);
      used += share;
    }
  }
  const first = entries[0]?.[0];
  if (first !== undefined)
    out.set(first, (out.get(first) ?? 0) + (total - used));
  return Object.fromEntries(out);
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

const SHOP_CAMPAIGNS = {
  [["newsletter", "email", "autumn-sale"].join(SEPARATOR)]: 0,
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
  const weekday = new Date(
    utcMidnight(Date.now()) - daysAgo * DAY_MS,
  ).getUTCDay();
  const weekly = weekday === 0 || weekday === 6 ? 0.62 : 1;
  const trend = 1 + dayIndex / (HISTORY_DAYS * 4);
  const spike =
    daysAgo === 8 ? 520 : daysAgo === 7 ? 240 : daysAgo === 9 ? 80 : 0;
  const base = 410 * weekly * trend * (0.9 + rnd() * 0.2);
  return { sessions: Math.round(base + spike), spike };
}

type Channel = "direct" | "paid" | "email" | "social" | "referral" | "organic";

/** The channel a demo campaign's sessions land in: its medium alone, as they carry no referrer. */
function mediumChannel(key: string): Channel {
  const medium = key.split(SEPARATOR)[1];
  if (medium === "cpc" || medium.startsWith("paid")) return "paid";
  if (medium === "email" || medium === "social" || medium === "referral")
    return medium;
  return "direct";
}

/** The channel an untagged session with this referrer lands in. */
function referrerChannel(domain: string): Channel {
  if (/google|bing|duckduckgo/.test(domain)) return "organic";
  return /linkedin|facebook/.test(domain) ? "social" : "referral";
}

/** Only the counted keys: a zero would still take a line in a top. */
function counted(map: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(map).filter(([, count]) => count > 0),
  );
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
) {
  const channels: Record<Channel, number> = {
    direct: sessions,
    paid: 0,
    email: 0,
    social: 0,
    referral: 0,
    organic: 0,
  };
  const take = (channel: Channel, count: number) => {
    channels[channel] += count;
    channels.direct -= count;
  };
  for (const [key, count] of Object.entries(campaigns)) {
    if (mediumChannel(key) !== "direct") take(mediumChannel(key), count);
  }
  for (const [domain, count] of Object.entries(referrers))
    take(referrerChannel(domain), count);
  return counted(channels);
}

/** One UTM field of the tagged sessions, read off their campaign keys. */
function utmTop(campaigns: Readonly<Record<string, number>>, field: number) {
  const top = new Map<string, number>();
  for (const [key, count] of Object.entries(campaigns)) {
    const value = key.split(SEPARATOR)[field];
    if (value) top.set(value, (top.get(value) ?? 0) + count);
  }
  return Object.fromEntries(top);
}

/**
 * One day of rollups. The newsletter spike arrives tagged, and referrers only
 * reach the sessions left, so tagged plus referred never exceeds the day.
 * UTM terms come with the paid search clicks, contents with any tagged link.
 */
function rollupRow(
  websiteId: string,
  day: number,
  { sessions, spike }: DayVolume,
  rnd: () => number,
  scale: number,
): Row {
  const pageviews = Math.round(sessions * (3.1 + rnd() * 0.3));
  const campaigns = { ...SHOP_CAMPAIGNS };
  campaigns[["newsletter", "email", "autumn-sale"].join(SEPARATOR)] =
    spike > 0 ? spike * 1.2 : 0.4;
  const base = sessions - spike;
  const tagged = Math.min(sessions, Math.round(base * 0.27 + spike * 0.9));
  const taggedCampaigns = counted(spread(tagged, campaigns));
  const referrers = counted(
    spread(
      Math.min(sessions - tagged, Math.round(base * 0.45)),
      SHOP_REFERRERS,
    ),
  );
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
      topEntryPages: spread(sessions, {
        "/": 40,
        "/sale/office-chairs": 30,
        "/products/standing-desks": 15,
        "/blog/desk-setup-guide": 9,
        "/pricing/b2b": 6,
      }),
      topExitPages: spread(sessions, {
        "/": 25,
        "/cart": 20,
        "/checkout": 18,
        "/sale/office-chairs": 22,
        "/pricing/b2b": 15,
      }),
      topReferrers: referrers,
      topUtmSources: utmTop(taggedCampaigns, 0),
      topUtmMediums: utmTop(taggedCampaigns, 1),
      topUtmCampaigns: utmTop(taggedCampaigns, 2),
      topUtmTerms: counted(
        spread(Math.min(paidClicks, Math.round(sessions * 0.04)), {
          "ergonomic office chair": 49,
          "standing desk b2b": 26,
          "office chair bulk": 17,
          "cable tray desk": 8,
        }),
      ),
      topUtmContents: counted(
        spread(Math.min(tagged, Math.round(sessions * 0.15)), {
          "hero-button": 50,
          "product-grid": 24,
          "carousel-2": 15,
          "footer-link": 11,
        }),
      ),
      topCampaigns: Object.fromEntries(
        Object.entries(taggedCampaigns).map(([key, count]) => [
          `${key}${SEPARATOR}${mediumChannel(key)}`,
          count,
        ]),
      ),
      topChannels: channels,
      topDevices: spread(sessions, { desktop: 68, mobile: 27, tablet: 5 }),
      topBrowsers: spread(sessions, {
        Chrome: 61,
        Safari: 22,
        Firefox: 9,
        Edge: 8,
      }),
      topCountries: spread(sessions, {
        FR: 31,
        DE: 20,
        GB: 16,
        BE: 11,
        NL: 9,
        ES: 5,
      }),
      topLanguages: spread(sessions, {
        "fr-FR": 34,
        "de-DE": 21,
        "en-GB": 24,
        "nl-NL": 11,
        "es-ES": 5,
      }),
      topEvents: spread(Math.round(sessions * 0.21 * scale), SHOP_EVENTS),
    },
  };
}

export async function seedRollups(
  websiteId: string,
  scale: number,
  seed: number,
): Promise<void> {
  const rnd = random(seed);
  const today = utcMidnight(Date.now());
  const rows: Row[] = [];
  for (let index = 0; index < HISTORY_DAYS; index++) {
    const day = today - (HISTORY_DAYS - 1 - index) * DAY_MS;
    const volume = shopVolume(index, rnd);
    const scaled = {
      sessions: Math.round(volume.sessions * scale),
      spike: Math.round(volume.spike * scale),
    };
    rows.push(rollupRow(websiteId, day, scaled, rnd, scale));
  }
  await table(
    TENANT_SCHEMA_NAME,
    "marketing_website_statistics",
    DEFAULT_TENANT_ID,
  )
    .insert(rows)
    .run();
}
