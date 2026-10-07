import { GetModel } from "@antelopejs/interface-database-decorators";
import { FunnelsModel, MarketingSessionsModel, PageSnapshotsModel } from "@/db";
import type { Website } from "@/db/tables/websites.table";
import { getConfig } from "@/config";
import {
  type ContextWebsite,
  loadWebsiteActivity,
  toContextWebsite,
} from "./context";
import { listRejectedSources, type RejectedSource } from "./origin-guard";
import { periodStart, resolveQueryWindow } from "./period";
import { mergeDimension, readRollups, sumRollups } from "./rollups";

const CARD_WINDOW_DAYS = "30d";

/** One card of the Websites page. */
export interface WebsiteCard extends ContextWebsite {
  extraDomains: string[];
  snapshotsEnabled: boolean;
  snapshotMaskText: boolean;
  createdAt: number;
  sessions: number;
  pages: number;
  funnels: number;
  snapshots: number;
  /** Share of page loads that record clicks and scrolls, 0–1. */
  sampleRate: number;
  rejected: RejectedSource[];
}

async function cardOf(
  website: Website,
  activity: ReadonlyMap<string, number>,
): Promise<WebsiteCard> {
  const rows = await readRollups(
    website,
    resolveQueryWindow({ period: CARD_WINDOW_DAYS }),
  );
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
  };
}

export async function websiteCards(
  tenantId: string,
  websites: Website[],
): Promise<WebsiteCard[]> {
  const activity = await loadWebsiteActivity(tenantId, websites);
  return Promise.all(websites.map((website) => cardOf(website, activity)));
}

/** The first pageview the install check shows once the tag works. */
export interface ConnectionVisit {
  at: number;
  url: string;
  browser?: string;
  deviceType?: string;
}

export interface ConnectionStatus {
  website: ContextWebsite;
  visit: ConnectionVisit | null;
  rejected: RejectedSource[];
}

/** Sessions older than this do not prove the tag on the page today. */
const RECENT_VISIT_DAYS = 90;

export async function connectionStatus(
  website: Website,
): Promise<ConnectionStatus> {
  const latest = await GetModel(
    MarketingSessionsModel,
    website.tenantId,
  ).getLatest(website._id);
  const recent =
    latest && new Date(latest.lastSeenAt) >= periodStart(RECENT_VISIT_DAYS)
      ? latest
      : undefined;
  const activity = new Map<string, number>(
    recent ? [[website._id, new Date(recent.lastSeenAt).getTime()]] : [],
  );
  return {
    website: toContextWebsite(website, activity),
    visit: recent
      ? {
          at: new Date(recent.lastSeenAt).getTime(),
          url: recent.entryUrl,
          browser: recent.browser,
          deviceType: recent.deviceType ?? "desktop",
        }
      : null,
    rejected: listRejectedSources(website._id),
  };
}
