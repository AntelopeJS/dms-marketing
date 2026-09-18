/**
 * Frontend marketing facade.
 *
 * Single composable wrapping every /api/marketing/* fetch the module pages
 * need — the one file to update when endpoint shapes change (same swap-point
 * convention as dms-api's useApiIntrospection).
 */

// --- Shapes mirrored from the backend ---------------------------------------

export interface MarketingWebsite {
  _id: string
  name: string
  domain: string
  trackingEnabled: boolean
  /** Opt-in: page snapshots store page content. */
  snapshotsEnabled: boolean
  snapshotMaskText?: boolean
}

/** Editable website fields; only the keys present are touched. */
export type MarketingWebsitePatch = Partial<
  Pick<MarketingWebsite, 'name' | 'domain' | 'snapshotsEnabled' | 'snapshotMaskText'>
>

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
  viewport: { width: number, height: number }
  document: { width: number, height: number }
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
}

export interface MarketingPages {
  pages: MarketingPageEntry[]
  /** The inventory hit its cap; narrow the search to see the rest. */
  truncated: boolean
  /** Share of visits capturing clicks — what makes a heatmap sparse. */
  heatmapSampleRate: number
  /** Global collection switch; off means nothing new is being recorded. */
  trackerEnabled: boolean
}

/** The five-way acquisition grouping the backend derives from referrer
 * domain + utm_medium at rollup time. */
export type MarketingChannel = 'direct' | 'organic' | 'social' | 'referral' | 'paid'

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

/** One (source, medium, campaign) triple observed on new sessions; a blank
 * slot is a UTM parameter the landing URL did not carry. */
export interface MarketingCampaignEntry {
  source?: string
  medium?: string
  campaign?: string
  sessions: number
}

export interface MarketingCampaigns {
  /** Exhaustive five-key split, not a top list. */
  channels: Partial<Record<MarketingChannel, number>>
  campaigns: MarketingCampaignEntry[]
  /** The table hit its cap; narrow the search to see the rest. */
  truncated: boolean
  terms: Record<string, number>
  contents: Record<string, number>
  /** Referrer domains across all channels (search and social included). */
  referrers?: Record<string, number>
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
  websiteId: string | { _id: string, name?: string, domain?: string }
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
}

export interface MarketingFunnelComputation {
  totalSessions: number
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
  /** Relative to the control's conversion; null on the control itself. */
  uplift: number | null
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
  variations: MarketingVariationResult[]
  srm: MarketingExperimentSrm
}

export interface MarketingFunnelResults {
  funnel: MarketingFunnel
  /** Over every session that entered the funnel, arms or not. */
  computation: MarketingFunnelComputation
  /** Present when the funnel carries an experiment past draft. */
  experiment?: MarketingExperimentResults
  /** The raw-event window hit its cap; verdicts are withheld. */
  truncated: boolean
  /** Epoch ms bounds the numbers cover: the selected period on a plain
   * funnel, the experiment's own run once one is started — a running split
   * ends at "now", a stopped one at its stop. */
  window: { since: number, until: number }
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
 * Scroll-depth distribution of one path. `views` counts only sampled views
 * that scrolled at all — a view that never scrolls (every page that fits its
 * screen included) emits no depth — so shares read "of the views that
 * scrolled", never "of all views".
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
    listWebsites: () => $authFetch<MarketingWebsite[]>('/api/marketing/websites'),

    createWebsite: (name: string, domain: string) =>
      $authFetch<MarketingWebsite>('/api/marketing/websites', {
        method: 'POST',
        body: { name, domain },
      }),

    updateWebsite: (id: string, patch: MarketingWebsitePatch) =>
      $authFetch<MarketingWebsite>(
        `/api/marketing/websites/${encodeURIComponent(id)}`,
        { method: 'PUT', body: patch },
      ),

    // Query strings via ofetch's `query` option — encoding is its job.
    listPages: (website: string, period = '7d', search = '') =>
      $authFetch<MarketingPages>('/api/marketing/stats/pages', {
        query: { website, period, search },
      }),

    getOverview: (website: string, period = '7d') =>
      $authFetch<MarketingOverview>('/api/marketing/stats/overview', {
        query: { website, period },
      }),

    getCampaigns: (website: string, period = '7d', search = '') =>
      $authFetch<MarketingCampaigns>('/api/marketing/stats/campaigns', {
        query: { website, period, search },
      }),

    getHeatmap: (website: string, path: string, period = '7d') =>
      $authFetch<MarketingHeatmap>('/api/marketing/stats/heatmap', {
        query: { website, path, period },
      }),

    getScrollDepth: (website: string, path: string, period = '7d') =>
      $authFetch<MarketingScrollDepth>('/api/marketing/stats/scroll', {
        query: { website, path, period },
      }),

    getSnapshot: (website: string, path: string, layout: MarketingSnapshotLayout) =>
      $authFetch<MarketingPageSnapshotResponse>('/api/marketing/stats/snapshot', {
        query: { website, path, layout },
      }),

    // Whole click and scroll history, every period: without `path` the whole
    // site's.
    resetHeatmap: (website: string, path?: string) =>
      $authFetch<{ deleted: number }>('/api/marketing/stats/heatmap', {
        method: 'DELETE',
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
      $authFetch<{ results: MarketingFunnelListItem[], total: number }>(
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
