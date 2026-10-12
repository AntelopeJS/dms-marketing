/**
 * Frontend marketing facade.
 *
 * Single composable wrapping every /api/marketing/* fetch the module pages
 * need — the one file to update when endpoint shapes change (same swap-point
 * convention as dms-api's useApiIntrospection).
 */

import type {
  ContextWebsite,
  MarketingContextPayload,
} from './useMarketingContext'

// --- Shapes mirrored from the backend ---------------------------------------

export type {
  ContextWebsite,
  MarketingContextPayload,
} from './useMarketingContext'

export interface MarketingRejectedSource {
  hostname: string
  count: number
  lastAt: number
}

/** One card of the Websites page (GET /api/marketing/websites/summary). */
export interface MarketingWebsiteCard extends ContextWebsite {
  extraDomains: string[]
  snapshotsEnabled: boolean
  snapshotMaskText: boolean
  createdAt: number
  /** Over the last 30 days, like `pages` (distinct paths). */
  sessions: number
  pages: number
  funnels: number
  snapshots: number
  sampleRate: number
  rejected: MarketingRejectedSource[]
}

/** What deleting a website discards (GET /websites/:id/deletion). */
export interface MarketingWebsiteDeletionImpact {
  /** Every stored day, not a window. */
  sessions: number
  pageviews: number
  /** Oldest stored day; null when nothing was recorded. */
  since: number | null
  funnels: number
  snapshots: number
}

export interface MarketingConnectionStatus {
  website: ContextWebsite
  createdAt: number
  /** Server time of the check: the `since` of a later "check again". */
  checkedAt: number
  /** Newest pageview since `since` (the site's creation by default). */
  visit: MarketingConnectionVisit | null
  lastActivityAt: number | null
  rejected: MarketingRejectedSource[]
}

export interface MarketingFunnelSuggestion {
  value: string
  count: number
}

export interface MarketingFunnelSuggestions {
  pages: MarketingFunnelSuggestion[]
  events: MarketingFunnelSuggestion[]
}

export interface MarketingWebsite {
  _id: string
  name: string
  domain: string
  trackingEnabled: boolean
  /** Opt-in: page snapshots store page content. */
  snapshotsEnabled: boolean
  snapshotMaskText?: boolean
  extraDomains?: string[]
}

/** Editable website fields; only the keys present are touched. */
export type MarketingWebsitePatch = Partial<
  Pick<
    MarketingWebsite,
    | 'name'
    | 'domain'
    | 'extraDomains'
    | 'trackingEnabled'
    | 'snapshotsEnabled'
    | 'snapshotMaskText'
  >
>

export interface MarketingWebsiteInput {
  name: string
  domain: string
  extraDomains?: string[]
}

export interface MarketingConnectionVisit {
  at: number
  /** Path only. */
  url: string
  /** The host the beacons came from, when the backend saw it. */
  host?: string
  browser?: string
  deviceType?: string
}

export type MarketingSnapshotLayout = 'desktop' | 'tablet' | 'phone'

/**
 * One captured rendering of a path: a self-contained HTML document the
 * heatmap is drawn over, plus the geometry it was captured in.
 */
export interface MarketingPageSnapshot {
  layout: MarketingSnapshotLayout
  /** False when the asked layout has no capture and the nearest stands in. */
  exact: boolean
  capturedAt: number
  origin: string
  viewport: { width: number; height: number }
  document: { width: number; height: number }
  colorScheme?: 'light' | 'dark'
  bytes: number
  html: string | null
}

export interface MarketingPageSnapshotResponse {
  /** Null while no visit has captured the page yet. */
  snapshot: MarketingPageSnapshot | null
}

/** One observed path of a tracked site, over the requested window. */
export interface MarketingPageEntry {
  path: string
  pageviews: number
  clicks: number
  /** Page loads sampled for clicks and scrolls, as counted. */
  sampled: number
}

/** The days a period-scoped read covers, local `YYYY-MM-DD`, both included. */
export interface MarketingDayRange {
  from: string
  to: string
}

export type MarketingPagesSort = 'views' | 'clicks'

/** Clicks and scrolls (`events`) and captures of a page or a whole site. */
export interface MarketingHeatmapData {
  events: number
  snapshots: number
}

export interface MarketingPages {
  pages: MarketingPageEntry[]
  /** Paths matching the search, listed or not. */
  total: number
  /** The inventory hit its cap; narrow the search to see the rest. */
  truncated: boolean
  /**
   * Measured share of page loads sampled for clicks — what makes a heatmap
   * sparse. Null while the site has too few pageviews to tell.
   */
  sampleRate: number | null
  /** Global collection switch; off means nothing new is being recorded. */
  trackerEnabled: boolean
}

export interface MarketingDayStatistics {
  day: number
  pageviews: number
  sessions: number
  newVisitors: number
  customEvents: number
  /** Counted as transitions: a day un-bouncing sessions opened the day
   * before can go negative. Clamp before showing a rate. */
  bouncedSessions: number
  sessionDurationMs: number
  topPages: Record<string, number>
  topEntryPages?: Record<string, number>
  topExitPages?: Record<string, number>
  topReferrers: Record<string, number>
  topUtmSources: Record<string, number>
  topUtmMediums?: Record<string, number>
  topUtmCampaigns?: Record<string, number>
  topUtmTerms?: Record<string, number>
  topUtmContents?: Record<string, number>
  topChannels?: Record<string, number>
  topDevices?: Record<string, number>
  topBrowsers?: Record<string, number>
  topCountries?: Record<string, number>
  topEvents?: Record<string, number>
  topLanguages?: Record<string, number>
}

export interface MarketingOverviewTotals {
  pageviews: number
  sessions: number
  newVisitors: number
  customEvents: number
  bouncedSessions: number
  sessionDurationMs: number
}

export interface MarketingOverview {
  totals: MarketingOverviewTotals
  days: MarketingDayStatistics[]
  topPages: Record<string, number>
  topEntryPages: Record<string, number>
  topExitPages: Record<string, number>
  topReferrers: Record<string, number>
  topUtmSources: Record<string, number>
  topUtmMediums: Record<string, number>
  topUtmCampaigns: Record<string, number>
  topUtmTerms: Record<string, number>
  topUtmContents: Record<string, number>
  topChannels: Record<string, number>
  topDevices: Record<string, number>
  topBrowsers: Record<string, number>
  /** ISO 3166-1 alpha-2 keys; only populated when the deployment configures
   * a GeoIP database — `geoipEnabled` says whether the card should show. */
  topCountries: Record<string, number>
  /** Custom event names by trigger count — which CTA gets clicked. */
  topEvents: Record<string, number>
  /** BCP 47 tags as the visitors' browsers report them (`fr`, `fr-FR`). */
  topLanguages: Record<string, number>
  geoipEnabled: boolean
}

export interface MarketingFunnelStep {
  kind: 'url' | 'custom'
  value: string
}

export type MarketingExperimentStatus = 'draft' | 'running' | 'stopped'

export interface MarketingExperimentVariation {
  key: string
  weight: number
}

/** One stretch of time the split served traffic; `stoppedAt` null while it
 * still does. Written by the lifecycle transitions alone — the form sends
 * them back untouched and the backend re-derives them. */
export interface MarketingExperimentRun {
  startedAt: number
  stoppedAt: number | null
}

/** The A/B facet of a funnel; the first variation is the control. */
export interface MarketingExperiment {
  key: string
  status: MarketingExperimentStatus
  variations: MarketingExperimentVariation[]
  /** Oldest first; more than one means the split was stopped and resumed.
   * Empty exactly while the split is a draft. */
  runs: MarketingExperimentRun[]
}

export interface MarketingFunnel {
  _id: string
  websiteId: string
  name: string
  steps: MarketingFunnelStep[]
  conversionWindowMs: number
  /** Null on a plain funnel. */
  experiment?: MarketingExperiment | null
}

/** One row of the definitions list — the data-api's Listable fields. Steps
 * and experiment may be JSON strings; read them through parseFunnelStepsValue
 * and parseExperimentValue. The website relation comes back expanded by the
 * list's foreign join — the write path wants the bare id again. */
export interface MarketingFunnelListItem {
  _id: string
  websiteId: string | { _id: string; name?: string; domain?: string }
  name: string
  steps: MarketingFunnelStep[] | string
  conversionWindowHours: number
  experiment?: MarketingExperiment | string | null
}

/** What the definitions form writes; hours because that is the field the
 * data-api exposes (it owns the ms conversion). `experiment.status` is the
 * transition asked for — it must be legal from the row's current one. */
export interface MarketingFunnelInput {
  websiteId: string
  name: string
  steps: MarketingFunnelStep[]
  /** Absent keeps the row's current window (edit) or the default (new). */
  conversionWindowHours?: number
  experiment?: MarketingExperiment | null
}

export interface MarketingFunnelStepResult {
  step: MarketingFunnelStep
  sessions: number
  conversionRate: number
  /** Events of the window matching the step, in order or not: 0 means the
   * site never sent it. */
  matches: number
}

export interface MarketingFunnelComputation {
  totalSessions: number
  /** Events read: 0 means the site sent nothing over the window. */
  events: number
  steps: MarketingFunnelStepResult[]
}

/** One arm's results. `computation` is the funnel shape, computed over the
 * arm's exposed sessions; `conversionRate` divides the last step by
 * `exposedSessions` — entering the funnel is itself an outcome. */
export interface MarketingVariationResult {
  key: string
  exposedSessions: number
  computation: MarketingFunnelComputation
  conversionRate: number
  /** Exposed sessions that reached the goal. */
  conversions: number
  /** Relative to the control's conversion; null on the control itself. */
  uplift: number | null
  /** Bounds of `uplift` at the test's level; null wherever pValue is. */
  upliftLow: number | null
  upliftHigh: number | null
  /** Two-sided p-value vs the control; null on the control, when the sample
   * is too small, or when the window is truncated. */
  pValue: number | null
  significant: boolean | null
}

export interface MarketingExperimentSrm {
  expected: number[]
  observed: number[]
  pValue: number | null
  /** True when the observed split is too far from the configured weights —
   * assignment or exposure reporting is suspect. */
  mismatch: boolean
}

export interface MarketingExperimentResults {
  /** Key of the control arm — the experiment's first variation. */
  control: string
  /** Level each challenger is tested at: .05, split past two arms. */
  alpha: number
  variations: MarketingVariationResult[]
  srm: MarketingExperimentSrm
  /** A verdict waits for a full week and a conversions floor per arm. */
  decision: {
    days: number
    minDays: number
    minConversions: number
    ready: boolean
  }
}

/** What raw events cover of the period and its comparison. */
export interface MarketingFunnelCoverage {
  /** First instant covered (epoch ms), null without any raw event. */
  since: number | null
  /** The period starts before it. */
  period: boolean
  /** The comparison starts before it: `previous` is left out. */
  previous: boolean
}

/** A funnel the site's own journeys suggest, for the first-run state. */
export interface MarketingFunnelTemplate {
  steps: MarketingFunnelStep[]
  /** Sessions of the period that matched step 1. */
  entering: number
}

/** What a started test says, read once by the server for the report, its
 * stop dialog and the list: `early` is significant but short of the decision
 * rule, `withheld` voided by a warning (truncated read, SRM, nothing scored). */
export interface MarketingExperimentVerdict {
  kind: 'winner' | 'loser' | 'flat' | 'early' | 'withheld'
  /** Index of the arm the verdict names, the control being 0; null when no
   * challenger could be scored. */
  leader: number | null
}

export interface MarketingFunnelResults {
  funnel: MarketingFunnel
  /** Over every session that entered the funnel, arms or not. */
  computation: MarketingFunnelComputation
  /** Present when the funnel carries an experiment past draft. */
  experiment?: MarketingExperimentResults
  /** The raw-event window hit its cap; verdicts are withheld. */
  truncated: boolean
  /** Null on a funnel without a started experiment. */
  verdict?: MarketingExperimentVerdict | null
  /** Epoch ms bounds the numbers cover: the selected period on a plain
   * funnel, the experiment's own run once one is started — a running split
   * ends at "now", a stopped one at its stop. */
  window: { since: number; until: number }
  /** The same funnel over the comparison window; null on a split, without
   * one, or when raw events do not cover it. */
  previous?: MarketingFunnelComputation | null
  coverage?: MarketingFunnelCoverage
}

export interface MarketingFunnelPreview {
  computation: MarketingFunnelComputation
  truncated: boolean
}

/**
 * Where the click landed inside the element it hit. This is what the overlay
 * projects from when it can locate the element in the rendered page; `x`/`y`
 * are the fallback, and they depend on the visitor's window on any page
 * shorter than it.
 */
export interface MarketingHeatmapAnchor {
  selector: string
  ox: number
  oy: number
  nth: number
}

export interface MarketingHeatmapPoint {
  x: number
  y: number
  weight: number
  /** Absent on clicks whose target was the document. */
  anchor?: MarketingHeatmapAnchor
}

export interface MarketingHeatmap {
  points: MarketingHeatmapPoint[]
  maxWeight: number
  totalClicks: number
  truncated: boolean
}

/**
 * Scroll-depth distribution of one path. Every sampled view reports one
 * depth, scrolled or not, so `views` is the number of sampled views (events
 * stored before the tracker did so only cover views that scrolled).
 */
export interface MarketingScrollDepth {
  views: number
  /** reached[d] = views whose max depth is ≥ d percent, d = 0..100. */
  reached: number[]
  truncated: boolean
}

// --- Facade -----------------------------------------------------------------

/** Far above any real tenant's funnel count — the data-api list answers 10
 * rows unless told otherwise, and caps at 100 whatever is asked. */
const FUNNEL_LIST_LIMIT = 100

export function useMarketingApi() {
  const { $authFetch } = useAuthFetch()

  return {
    listWebsites: () =>
      $authFetch<MarketingWebsite[]>('/api/marketing/websites'),

    getContext: () =>
      $authFetch<MarketingContextPayload>('/api/marketing/context'),

    createWebsite: (input: MarketingWebsiteInput) =>
      $authFetch<MarketingWebsite>('/api/marketing/websites', {
        method: 'POST',
        body: input,
      }),

    selectContextWebsite: (website: string) =>
      $authFetch<MarketingContextPayload>('/api/marketing/context', {
        method: 'PUT',
        body: { website },
      }),

    listWebsiteCards: () =>
      $authFetch<MarketingWebsiteCard[]>('/api/marketing/websites/summary'),

    // `since` (epoch ms, server clock): only a pageview from then on counts.
    getConnection: (website: string, since?: number) =>
      $authFetch<MarketingConnectionStatus>(
        `/api/marketing/websites/${encodeURIComponent(website)}/connection`,
        { query: { since } },
      ),

    getWebsiteDeletionImpact: (website: string) =>
      $authFetch<MarketingWebsiteDeletionImpact>(
        `/api/marketing/websites/${encodeURIComponent(website)}/deletion`,
      ),

    allowHost: (website: string, hostname: string) =>
      $authFetch<MarketingWebsite>(
        `/api/marketing/websites/${encodeURIComponent(website)}/allow-host`,
        { method: 'POST', body: { hostname } },
      ),

    deleteWebsite: (website: string) =>
      $authFetch<{ deleted: string }>(
        `/api/marketing/websites/${encodeURIComponent(website)}`,
        { method: 'DELETE' },
      ),

    // A period as the context bar holds it (`from`/`to` local days).
    getFunnelTemplates: (website: string, from: string, to: string) =>
      $authFetch<MarketingFunnelTemplate[]>(
        '/api/marketing/funnels/templates',
        {
          query: { website, from, to },
        },
      ),

    getFunnelSuggestions: (website: string) =>
      $authFetch<MarketingFunnelSuggestions>(
        '/api/marketing/funnels/suggestions',
        {
          query: { website, period: '30d' },
        },
      ),

    previewFunnel: (
      website: string,
      steps: MarketingFunnelStep[],
      conversionWindowHours: number,
    ) =>
      $authFetch<MarketingFunnelPreview>('/api/marketing/funnels/preview', {
        method: 'POST',
        query: { website, period: '30d' },
        body: { steps, conversionWindowHours },
      }),

    updateWebsite: (id: string, patch: MarketingWebsitePatch) =>
      $authFetch<MarketingWebsite>(
        `/api/marketing/websites/${encodeURIComponent(id)}`,
        { method: 'PUT', body: patch },
      ),

    // Query strings via ofetch's `query` option — encoding is its job.
    listPages: (
      website: string,
      range: MarketingDayRange,
      search = '',
      sort: MarketingPagesSort = 'views',
    ) =>
      $authFetch<MarketingPages>('/api/marketing/stats/pages', {
        query: { website, ...range, search, sort },
      }),

    getOverview: (website: string, period = '7d') =>
      $authFetch<MarketingOverview>('/api/marketing/stats/overview', {
        query: { website, period },
      }),

    getHeatmap: (website: string, path: string, range: MarketingDayRange) =>
      $authFetch<MarketingHeatmap>('/api/marketing/stats/heatmap', {
        query: { website, path, ...range },
      }),

    getScrollDepth: (website: string, path: string, range: MarketingDayRange) =>
      $authFetch<MarketingScrollDepth>('/api/marketing/stats/scroll', {
        query: { website, path, ...range },
      }),

    getSnapshot: (
      website: string,
      path: string,
      layout: MarketingSnapshotLayout,
    ) =>
      $authFetch<MarketingPageSnapshotResponse>(
        '/api/marketing/stats/snapshot',
        {
          query: { website, path, layout },
        },
      ),

    // Whole click and scroll history, every period: without `path` the whole
    // site's.
    resetHeatmap: (website: string, path?: string) =>
      $authFetch<MarketingHeatmapData>('/api/marketing/stats/heatmap', {
        method: 'DELETE',
        query: { website, path },
      }),

    /** What `resetHeatmap` would delete with the same arguments. */
    countHeatmap: (website: string, path?: string) =>
      $authFetch<MarketingHeatmapData>('/api/marketing/stats/heatmap/count', {
        query: { website, path },
      }),

    getFunnelResults: (id: string, period = '7d') =>
      $authFetch<MarketingFunnelResults>(
        `/api/marketing/funnels/${encodeURIComponent(id)}/results`,
        { query: { period } },
      ),

    // Definitions CRUD over the funnels data-api routes. `is` is the DMS
    // DataType compare mode — the data-api's own `eq` parses but matches
    // nothing. The list defaults to 10 rows, hence the explicit limit.
    listFunnels: (website: string) =>
      $authFetch<{ results: MarketingFunnelListItem[]; total: number }>(
        '/api/marketing/tables/funnels/list',
        {
          query: {
            filter_websiteId: `is:${website}`,
            limit: FUNNEL_LIST_LIMIT,
            sortKey: 'createdAt',
            sortDirection: 'asc',
          },
        },
      ),

    // One definition, as the builder edits it: no results computed.
    getFunnel: (id: string) =>
      $authFetch<MarketingFunnelListItem>('/api/marketing/tables/funnels/get', {
        query: { id },
      }),

    // The insert answers the generated keys, an array — not the row.
    createFunnel: (input: MarketingFunnelInput) =>
      $authFetch<string[]>('/api/marketing/tables/funnels/new', {
        method: 'POST',
        body: input,
      }),

    updateFunnel: (id: string, input: MarketingFunnelInput) =>
      $authFetch<unknown>('/api/marketing/tables/funnels/edit', {
        method: 'PUT',
        query: { id },
        body: input,
      }),

    deleteFunnel: (id: string) =>
      $authFetch<unknown>('/api/marketing/tables/funnels/delete', {
        method: 'DELETE',
        query: { id },
      }),
  }
}
