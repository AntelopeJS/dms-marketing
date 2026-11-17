import { GetModel } from "@antelopejs/interface-database-decorators";
import { FunnelTrailsModel } from "@/db";
import type { TrailEvent, TrailSession } from "@/db/models/funnel_trails.model";
import type { FunnelStep } from "@/db/tables/funnels.table";
import type { Website } from "@/db/tables/websites.table";
import type { QueryWindow } from "@/services/period";

/** A funnel the site's own journeys suggest, with the sessions it would score. */
export interface FunnelTemplate {
  steps: FunnelStep[];
  /** Sessions of the window that would enter it (that matched step 1). */
  entering: number;
}

const MAX_TEMPLATES = 2;

type FirstSeen = readonly [
  sessionAt: number,
  sessionId: string,
  position: number,
];

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function compareFirstSeen(a: FirstSeen, b: FirstSeen): number {
  return a[0] - b[0] || compareText(a[1], b[1]) || a[2] - b[2];
}

class SessionCounts {
  readonly #counts = new Map<string, { count: number; first: FirstSeen }>();

  add(session: TrailSession, values: readonly string[]): void {
    const sessionAt = session.events[0]?.at ?? 0;
    new Set(values).forEach((value) => {
      const first: FirstSeen = [
        sessionAt,
        session.sessionId,
        values.indexOf(value),
      ];
      const entry = this.#counts.get(value);
      if (!entry) {
        this.#counts.set(value, { count: 1, first });
        return;
      }
      entry.count++;
      if (compareFirstSeen(first, entry.first) < 0) {
        entry.first = first;
      }
    });
  }

  count(value: string): number {
    return this.#counts.get(value)?.count ?? 0;
  }

  ranked(): string[] {
    return [...this.#counts.entries()]
      .sort(
        ([, a], [, b]) =>
          b.count - a.count || compareFirstSeen(a.first, b.first),
      )
      .map(([value]) => value);
  }
}

function pagesOf(events: readonly TrailEvent[]): string[] {
  return events.flatMap((event) =>
    event.kind === "pageview" ? [event.path] : [],
  );
}

function namesOf(events: readonly TrailEvent[]): string[] {
  return events.flatMap((event) =>
    event.kind === "custom" && event.name ? [event.name] : [],
  );
}

interface LeadPages {
  name: string;
  pages: SessionCounts;
}

function addLeadPages(lead: LeadPages, session: TrailSession): void {
  const at = session.events.findIndex(
    (event) => event.kind === "custom" && event.name === lead.name,
  );
  if (at > 0) {
    lead.pages.add(session, pagesOf(session.events.slice(0, at)));
  }
}

/**
 * Templates for a site without funnels, from real journeys: its custom
 * events triggered by the most sessions, each led by the page those sessions
 * viewed most often before it. `entering` counts the sessions that viewed
 * that page, the ones the funnel would see enter.
 *
 * Two streamed passes over the funnel trails of the window: the first counts
 * names and pages, the second the pages viewed before each top name. Memory
 * holds one entry per distinct name and page, whatever the window holds.
 */
export async function funnelTemplates(
  website: Website,
  window: QueryWindow,
): Promise<FunnelTemplate[]> {
  const sessions = () =>
    GetModel(FunnelTrailsModel, website.tenantId).sessionsIn({
      websiteId: website._id,
      since: window.since.getTime(),
      until: window.until.getTime(),
      withExposures: false,
    });
  const names = new SessionCounts();
  const pages = new SessionCounts();
  for await (const session of sessions()) {
    names.add(session, namesOf(session.events));
    pages.add(session, pagesOf(session.events));
  }
  const leads: LeadPages[] = names
    .ranked()
    .slice(0, MAX_TEMPLATES)
    .map((name) => ({ name, pages: new SessionCounts() }));
  if (leads.length > 0) {
    for await (const session of sessions()) {
      leads.forEach((lead) => addLeadPages(lead, session));
    }
  }
  return leads.map(({ name, pages: before }) => {
    const [page] = before.ranked();
    return page === undefined
      ? {
          steps: [{ kind: "custom", value: name }],
          entering: names.count(name),
        }
      : {
          steps: [
            { kind: "url", value: page },
            { kind: "custom", value: name },
          ],
          entering: pages.count(page),
        };
  });
}
