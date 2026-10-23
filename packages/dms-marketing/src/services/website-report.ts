import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  FunnelsModel,
  MarketingEventsModel,
  MarketingSessionsModel,
  PageSnapshotsModel,
  WebsiteStatisticsModel,
} from "@/db";
import type { Website } from "@/db/tables/websites.table";
import { getConfig } from "@/config";
import {
  type ContextWebsite,
  loadImportedThrough,
  loadWebsiteActivity,
  toContextWebsite,
  type WebsiteActivity,
} from "./context";
import { isDashboardWebsite } from "./dashboard-tracking";
import { listRejectedSources, type RejectedSource } from "./origin-guard";
import { periodStart, trailingWindow } from "./period";
import { mergeDimension, readRollups, sumRollups } from "./rollups";
import { lastAcceptedSource } from "./website-hosts";

const CARD_WINDOW_DAYS = 30;

/** One card of the Websites page. */
export interface WebsiteCard extends ContextWebsite {
  extraDomains: string[];
  snapshotsEnabled: boolean;
  snapshotMaskText: boolean;
  createdAt: number;
  /** Over the last 30 days, like `pages`. */
  sessions: number;
  /** Distinct paths viewed. */
  pages: number;
  funnels: number;
  snapshots: number;
  /** Share of page loads that record clicks and scrolls, 0–1. */
  sampleRate: number;
  rejected: RejectedSource[];
  /** The site `dashboardTracking` provisions: it cannot be deleted. */
  dashboard: boolean;
}

async function cardOf(
  website: Website,
  activity: WebsiteActivity,
): Promise<WebsiteCard> {
  const rows = await readRollups(website, trailingWindow(CARD_WINDOW_DAYS));
  const [funnels, snapshots] = await Promise.all([
    GetModel(FunnelsModel, website.tenantId).listByWebsite(website._id),
    GetModel(PageSnapshotsModel, website.tenantId).countByWebsite(website._id),
  ]);
  return {
    ...toContextWebsite(website, activity),
    extraDomains: website.extraDomains ?? [],
    snapshotsEnabled: website.snapshotsEnabled,
    snapshotMaskText: website.snapshotMaskText ?? false,
    createdAt: new Date(website.createdAt).getTime(),
    sessions: sumRollups(rows).sessions,
    pages: Object.keys(mergeDimension(rows, "topPages")).length,
    funnels: funnels.length,
    snapshots,
    sampleRate: getConfig().heatmapSampleRate,
    rejected: listRejectedSources(website._id),
    dashboard: isDashboardWebsite(website),
  };
}

export async function websitesSummary(
  tenantId: string,
  websites: Website[],
): Promise<WebsiteCard[]> {
  const activity = await loadWebsiteActivity(tenantId, websites);
  return Promise.all(websites.map((website) => cardOf(website, activity)));
}

/**
 * Each listed row with its card, in the list's order; a row whose card is
 * missing (the site went between the two reads) is listed as it came.
 */
export function mergeWebsiteCards<Row extends { _id: string }>(
  rows: Row[],
  cards: WebsiteCard[],
): Row[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return rows.map((row) => {
    const card = byId.get(row._id);
    return card ? { ...row, ...card } : row;
  });
}

/**
 * What deleting a website, or purging its data, discards: for their
 * confirmations.
 */
export interface WebsiteDeletionImpact {
  /** Every stored day, not a window: the rollups all go. */
  sessions: number;
  pageviews: number;
  /** Epoch ms of the oldest stored day; null when nothing was recorded. */
  since: number | null;
  funnels: number;
  snapshots: number;
  /** Clicks and scrolls, every period: what the heatmaps are drawn from. */
  heatmapEvents: number;
}

export async function websiteDeletionImpact(
  website: Website,
): Promise<WebsiteDeletionImpact> {
  const [days, funnels, snapshots, heatmapEvents] = await Promise.all([
    GetModel(WebsiteStatisticsModel, website.tenantId).getCounters(website._id),
    GetModel(FunnelsModel, website.tenantId).listByWebsite(website._id),
    GetModel(PageSnapshotsModel, website.tenantId).countByWebsite(website._id),
    GetModel(MarketingEventsModel, website.tenantId).countHeatmapEvents(
      website._id,
    ),
  ]);
  return {
    sessions: days.reduce((sum, day) => sum + (day.sessions ?? 0), 0),
    pageviews: days.reduce((sum, day) => sum + (day.pageviews ?? 0), 0),
    since: days.length > 0 ? Math.min(...days.map((day) => day.day)) : null,
    funnels: funnels.length,
    snapshots,
    heatmapEvents,
  };
}

/** The pageview the install check shows once the tag works. */
export interface ConnectionVisit {
  at: number;
  /** Path only: raw events keep no host. */
  url: string;
  /** The host the site's beacons last came from, when this instance saw it. */
  host?: string;
  browser?: string;
  deviceType?: string;
}

export interface ConnectionStatus {
  website: ContextWebsite;
  createdAt: number;
  /** Server time of the check: the `since` of a later "check again". */
  checkedAt: number;
  /** Newest pageview at or after `since`; null while none arrived. */
  visit: ConnectionVisit | null;
  /** Epoch ms of the site's last activity, whatever `since` says. */
  lastActivityAt: number | null;
  rejected: RejectedSource[];
}

/** Sessions older than this do not prove the tag on the page today. */
const RECENT_VISIT_DAYS = 90;

/**
 * The install check. `since` (epoch ms) defaults to the site's creation, so
 * a new site turns green on its first pageview and an installed one shows its
 * latest; the guide's "Check again" passes the time it started waiting, so
 * only a pageview sent after it counts.
 */
export async function connectionStatus(
  website: Website,
  since?: number,
): Promise<ConnectionStatus> {
  const createdAt = new Date(website.createdAt).getTime();
  const checkedAt = Date.now();
  const from = Math.max(
    since ?? createdAt,
    periodStart(RECENT_VISIT_DAYS).getTime(),
  );
  const [pageview, latest, importedThrough] = await Promise.all([
    GetModel(MarketingEventsModel, website.tenantId).getLatestPageview(
      website._id,
      new Date(from),
    ),
    GetModel(MarketingSessionsModel, website.tenantId).getLatest(website._id),
    loadImportedThrough(website.tenantId, [website]),
  ]);
  const lastActivityAt = latest ? new Date(latest.lastSeenAt).getTime() : null;
  const lastActivity = new Map<string, number>(
    lastActivityAt === null ? [] : [[website._id, lastActivityAt]],
  );
  return {
    website: toContextWebsite(website, { lastActivity, importedThrough }),
    createdAt,
    checkedAt,
    visit: pageview ? await visitOf(website, pageview, from) : null,
    lastActivityAt,
    rejected: listRejectedSources(website._id),
  };
}

async function visitOf(
  website: Website,
  pageview: { timestamp: Date; url: string; sessionId: string },
  from: number,
): Promise<ConnectionVisit> {
  const session = await GetModel(MarketingSessionsModel, website.tenantId).get(
    pageview.sessionId,
  );
  const source = lastAcceptedSource(website._id);
  return {
    at: new Date(pageview.timestamp).getTime(),
    url: pageview.url,
    host: source && source.at >= from ? source.hostname : undefined,
    browser: session?.browser,
    deviceType: session?.deviceType ?? "desktop",
  };
}
