import { MARKETING_CHANNELS, type MarketingChannel } from "@/types";
import { CAMPAIGN_KEY_SEPARATOR } from "@/types/constants";

/**
 * Acquisition classification: the channel grouping and the composite
 * campaign key, both resolved when a session's rollup increment fires.
 * Neither is stored on the session — everything here derives from fields the
 * session already carries, so the mapping can change without a migration.
 */

/**
 * Click-id parameters only an ad platform mints: their presence is the click's
 * own proof it was bought. Worth reading because auto-tagged campaigns carry
 * no utm_medium at all — an auto-tagged Google Ads click keeps google.com as
 * its referrer and would otherwise classify as organic.
 *
 * `gclid`, `gbraid` (iOS app-to-web) and `wbraid` (iOS web-to-app) are Google
 * Ads', `dclid` Google Display & Video 360's, `msclkid` Microsoft
 * Advertising's, `ttclid` TikTok Ads', `twclid` X Ads' and `li_fat_id`
 * LinkedIn Ads'.
 */
const PAID_CLICK_IDS = new Set([
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "msclkid",
  "ttclid",
  "twclid",
  "li_fat_id",
]);

/**
 * Meta stamps these on every outbound link, ad or not, so they attest the
 * platform and never the spend — reading them as paid would book organic
 * shares as ad clicks. Their worth is the in-app browser, which sends no
 * referrer. `fbclid` comes from Facebook and Instagram, `igshid` from
 * Instagram shares.
 */
const SOCIAL_CLICK_IDS = new Set(["fbclid", "igshid"]);

/** Probed in order against an entry URL; first hit wins. */
export const CLICK_ID_PARAMS: readonly string[] = [
  ...PAID_CLICK_IDS,
  ...SOCIAL_CLICK_IDS,
];

/** Mediums advertisers use for bought traffic; anything starting with "paid"
 * (paid-social, paid_search…) matches by prefix instead. */
const PAID_MEDIUMS = new Set([
  "cpc",
  "ppc",
  "cpm",
  "cpv",
  "cpa",
  "cpp",
  "sem",
  "display",
  "banner",
  "retargeting",
]);

const SOCIAL_MEDIUMS = new Set([
  "social",
  "social-media",
  "social_media",
  "socialmedia",
  "social-network",
  "social_network",
  "sm",
]);

/**
 * Matched against the dot-separated labels of the referrer domain, so
 * "l.facebook.com", "out.reddit.com" and "google.co.uk" classify without
 * enumerating every mirror and country TLD.
 */
const SEARCH_ENGINE_LABELS = new Set([
  "google",
  "bing",
  "duckduckgo",
  "yahoo",
  "baidu",
  "yandex",
  "ecosia",
  "qwant",
  "startpage",
  "seznam",
  "naver",
]);

const SOCIAL_LABELS = new Set([
  "facebook",
  "instagram",
  "threads",
  "twitter",
  "linkedin",
  "reddit",
  "pinterest",
  "tiktok",
  "youtube",
  "snapchat",
  "whatsapp",
  "telegram",
  "discord",
  "twitch",
  "mastodon",
  "bsky",
  "tumblr",
  "vk",
  "weibo",
]);

/** Shorteners and mobile hosts whose labels never spell the network out. */
const SOCIAL_DOMAINS = new Set([
  "t.co",
  "x.com",
  "youtu.be",
  "fb.me",
  "fb.watch",
  "lnkd.in",
  "wa.me",
  "pin.it",
]);

/**
 * Mediums mailing tools tag their links with. Read before the referrer rules:
 * a click from a desktop mail client or a webmail sends no referrer, or the
 * webmail's own host, and would otherwise count as direct or referral.
 */
const EMAIL_MEDIUMS = new Set([
  "email",
  "e-mail",
  "e_mail",
  "newsletter",
  "mail",
]);

/** Mediums that declare a referral outright, referrer or not (partner links). */
const REFERRAL_MEDIUMS = new Set(["referral", "affiliate", "partner"]);

function hasListedLabel(
  domain: string | undefined,
  labels: ReadonlySet<string>,
): boolean {
  if (!domain) {
    return false;
  }
  return domain.split(".").some((label) => labels.has(label));
}

/** Exact hosts of search-engine companies that are not their search product:
 * without this, a Gmail or Google Docs referral would count as organic. */
const NON_SEARCH_DOMAINS = new Set([
  "mail.google.com",
  "drive.google.com",
  "docs.google.com",
  "sites.google.com",
  "groups.google.com",
  "play.google.com",
  "maps.google.com",
  "news.google.com",
  "mail.yahoo.com",
  "news.yahoo.com",
  "finance.yahoo.com",
]);

function isSearchDomain(domain: string | undefined): boolean {
  if (!domain || NON_SEARCH_DOMAINS.has(domain)) {
    return false;
  }
  return hasListedLabel(domain, SEARCH_ENGINE_LABELS);
}

function isPaidMedium(medium: string): boolean {
  return PAID_MEDIUMS.has(medium) || medium.startsWith("paid");
}

function isSocialSource(domain: string | undefined, medium: string): boolean {
  return (
    SOCIAL_MEDIUMS.has(medium) ||
    SOCIAL_DOMAINS.has(domain ?? "") ||
    hasListedLabel(domain, SOCIAL_LABELS)
  );
}

/**
 * The channel grouping of a session, from its referrer domain, utm_medium and
 * ad click-id parameter. Paid wins first: an ad click keeps its referrer
 * (google.com, facebook.com) and would otherwise read as organic or social.
 * Email comes next, on its medium alone. A medium the mapping does not know
 * keeps referrer semantics — referral with a referrer, direct without one.
 */
export function resolveChannel(
  referrerDomain: string | undefined,
  utmMedium: string | undefined,
  clickIdParam?: string,
): MarketingChannel {
  const medium = utmMedium?.trim().toLowerCase() ?? "";
  const clickId = clickIdParam ?? "";
  if (isPaidMedium(medium) || PAID_CLICK_IDS.has(clickId)) {
    return "paid";
  }
  if (EMAIL_MEDIUMS.has(medium)) {
    return "email";
  }
  if (isSocialSource(referrerDomain, medium) || SOCIAL_CLICK_IDS.has(clickId)) {
    return "social";
  }
  if (medium === "organic" || isSearchDomain(referrerDomain)) {
    return "organic";
  }
  return referrerDomain || REFERRAL_MEDIUMS.has(medium) ? "referral" : "direct";
}

export interface CampaignUtm {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

/** What a campaign key reads off its session: the triple and its channel. */
export interface CampaignSession extends CampaignUtm {
  referrerDomain?: string;
  clickIdParam?: string;
}

/**
 * How a UTM value is compared and stored: trimmed, and source and medium in
 * lower case — "Email", "email" and "email " are one medium to a marketer,
 * while a campaign keeps the case it was named with.
 */
export function normalizeUtm(
  field: "source" | "medium" | "campaign" | "term" | "content",
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return field === "source" || field === "medium"
    ? trimmed.toLowerCase()
    : trimmed;
}

/**
 * One `topCampaigns` map key per (source, medium, campaign) triple and the
 * channel its session was counted under: without referrer or click id, the
 * table could only guess the channel from the medium. Blank slots stay blank
 * — the split answers them as undefined — and a session carrying none of the
 * three contributes nothing: the campaigns table lists campaigns, not
 * traffic.
 */
export function campaignKey(session: CampaignSession): string | undefined {
  const parts = [session.utmSource, session.utmMedium, session.utmCampaign];
  if (parts.every((part) => !part)) {
    return undefined;
  }
  const channel = resolveChannel(
    session.referrerDomain,
    session.utmMedium,
    session.clickIdParam,
  );
  return [...parts.map((part) => part ?? ""), channel].join(
    CAMPAIGN_KEY_SEPARATOR,
  );
}

export interface CampaignKeyParts {
  source?: string;
  medium?: string;
  campaign?: string;
  channel: MarketingChannel;
}

function isChannel(value: string | undefined): value is MarketingChannel {
  return MARKETING_CHANNELS.some((channel) => channel === value);
}

/**
 * A key `campaignKey` minted, split back: blank slots read as undefined.
 * Undefined for a key without its channel, which the table cannot place.
 */
export function splitCampaignKey(key: string): CampaignKeyParts | undefined {
  const [source, medium, campaign, channel] = key.split(CAMPAIGN_KEY_SEPARATOR);
  if (!isChannel(channel)) {
    return undefined;
  }
  return {
    source: source || undefined,
    medium: medium || undefined,
    campaign: campaign || undefined,
    channel,
  };
}
