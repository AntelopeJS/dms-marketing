<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from '#dms/frontend-module'
import { useChildId } from '../composables/useChildId'
import { useLatestRequest } from '../composables/useLatestRequest'
import {
  useMarketingApi,
  type MarketingOverview,
} from '../composables/useMarketingApi'
import {
  DEFAULT_PERIOD_PRESET,
  MARKETING_PERIOD_PRESETS,
  MS_PER_DAY,
  periodDays,
  useMarketingPeriod,
} from '../composables/useMarketingPeriod'
import {
  campaignsLink,
  funnelsLink,
  pagesLink,
} from '../composables/useMarketingRoutes'
import { useMarketingWebsites } from '../composables/useMarketingWebsites'

/**
 * Overview dashboard: period-scoped traffic area chart, device donut and
 * the top dimensions grouped into four cards — content, acquisition,
 * audience, events — each a tabbed stack of top lists linking out to the
 * surface that owns the detail (pages, campaigns, funnels). All of it is
 * fed by one rollup-backed overview fetch. Chart/KPI primitives come from
 * the dms-ui layer so the look is inherited, not ported; UTM sources have
 * no card here on purpose — the campaigns table is their surface.
 */
const PERIOD_SCOPE = 'dms-marketing-overview'
const TOP_LIST_LIMIT = 8

// The DMS page renderer hands every component its identity; keeping it is what
// lets dms-ui primitives key their events and persisted state per child.
const props = withDefaults(
  defineProps<{ componentId?: string, pageId?: string }>(),
  { componentId: 'marketing-overview', pageId: 'marketing' },
)

const childId = useChildId(() => props.componentId)

const api = useMarketingApi()
const { t, te, locale } = useI18n()

const {
  websites,
  items: websiteItems,
  selectedId,
  loading: loadingWebsites,
  failed: websitesFailed,
  load: loadWebsites,
  create: createWebsite,
  showSnippet,
} = useMarketingWebsites()

// Period comes from the DMS-standard <DmsPeriodSelector>, read back through
// its scope registry and mapped onto the `Nd` windows the backend accepts.
const period = useMarketingPeriod(PERIOD_SCOPE)

const windowLength = computed(() => periodDays(period.value))

const {
  data: overview,
  loading: loadingOverview,
  failed: overviewFailed,
  settled: overviewSettled,
  run: loadOverview,
} = useLatestRequest<MarketingOverview>(() =>
  // Server-side there is no session to authenticate with: the fetch belongs to
  // the client, like every other read here.
  selectedId.value && !import.meta.env.SSR
    ? api.getOverview(selectedId.value, period.value)
    : null,
)

// The watcher owns every overview fetch, including the first: seeding it from
// onMounted as well would issue the initial request twice. The endpoint lists
// websites by last activity, so the default selection is the one that has
// something to show. Immediate costs nothing while the selection starts empty
// — the fetcher just answers null — and is what keeps this correct the day a
// deep link seeds it: resolving the site list would then write the same id
// back, which is no change to watch, and a non-immediate watcher would never
// fetch at all.
watch([selectedId, period], () => {
  void loadOverview()
}, { immediate: true })

/**
 * The window between a site being selected and the watcher firing on the next
 * tick counts as loading: dropping the flag there would flash an empty
 * dashboard between the two fetches.
 */
const loading = computed(
  () =>
    loadingWebsites.value
    || loadingOverview.value
    || (!!selectedId.value && !overviewSettled.value),
)

// Two failures, two flags: retrying the overview must not clear the one that
// says the site list itself never loaded.
const failed = computed(() => websitesFailed.value || overviewFailed.value)

/** Retry entry point: whichever of the two fetches has nothing to show. */
function reload() {
  return websites.value.length === 0 ? loadWebsites() : loadOverview()
}

onMounted(loadWebsites)

// --- KPIs -------------------------------------------------------------------

/** "1m 32s" the way Plausible writes it — locale-neutral abbreviations. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

interface OverviewKpi {
  id: string
  label: string
  icon: string
  /** Rendered by DmsKpiCard when numeric… */
  value?: number
  format?: 'number' | 'percent'
  /** …and by the local text card when already composed (duration). */
  display?: string
}

const kpis = computed<OverviewKpi[]>(() => {
  const totals = overview.value?.totals
  const sessions = totals?.sessions ?? 0
  // Transition-counted bounces can sum below zero on windows cutting a
  // session in two; a negative rate is never worth showing.
  const bounceRate = sessions > 0
    ? (Math.max(0, totals?.bouncedSessions ?? 0) / sessions) * 100
    : 0
  const pagesPerSession = sessions > 0
    ? Math.round(((totals?.pageviews ?? 0) / sessions) * 10) / 10
    : 0
  const avgDuration = sessions > 0 ? (totals?.sessionDurationMs ?? 0) / sessions : 0
  return [
    { id: 'pageviews', label: t('page.marketing.overview.kpis.pageviews'), value: totals?.pageviews ?? 0, format: 'number', icon: 'i-ph-eye' },
    { id: 'sessions', label: t('page.marketing.overview.kpis.sessions'), value: totals?.sessions ?? 0, format: 'number', icon: 'i-ph-users' },
    { id: 'new-visitors', label: t('page.marketing.overview.kpis.new_visitors'), value: totals?.newVisitors ?? 0, format: 'number', icon: 'i-ph-user-plus' },
    { id: 'custom-events', label: t('page.marketing.overview.kpis.custom_events'), value: totals?.customEvents ?? 0, format: 'number', icon: 'i-ph-cursor-click' },
    { id: 'bounce-rate', label: t('page.marketing.overview.kpis.bounce_rate'), value: bounceRate, format: 'percent', icon: 'i-ph-arrow-u-up-left' },
    { id: 'avg-session-duration', label: t('page.marketing.overview.kpis.avg_session_duration'), display: formatDuration(avgDuration), icon: 'i-ph-timer' },
    { id: 'pages-per-session', label: t('page.marketing.overview.kpis.pages_per_session'), value: pagesPerSession, format: 'number', icon: 'i-ph-stack' },
  ]
})

// --- Traffic chart ----------------------------------------------------------

function utcMidnightToday(): number {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

/** Every day of the window, so days without traffic plot at zero. */
const windowDays = computed(() => {
  const today = utcMidnightToday()
  const count = windowLength.value
  return Array.from({ length: count }, (_, i) => today - (count - 1 - i) * MS_PER_DAY)
})

const trafficSeries = computed(() => {
  const days = overview.value?.days ?? []
  const byDay = new Map(days.map(d => [d.day, d]))
  const point = (day: number, pick: (v: { pageviews: number, sessions: number }) => number) => ({
    x: new Date(day),
    y: pick(byDay.get(day) ?? { pageviews: 0, sessions: 0 }),
  })
  return [
    {
      name: t('page.marketing.overview.traffic.pageviews'),
      data: windowDays.value.map(day => point(day, v => v.pageviews)),
    },
    {
      name: t('page.marketing.overview.traffic.sessions'),
      data: windowDays.value.map(day => point(day, v => v.sessions)),
    },
  ]
})

const hasTraffic = computed(() => (overview.value?.totals.pageviews ?? 0) > 0)

// --- Devices donut ----------------------------------------------------------

const deviceRecords = computed(() =>
  Object.entries(overview.value?.topDevices ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value })),
)

// --- Top lists --------------------------------------------------------------

/**
 * `linkTo` is only passed for pages: a path has a surface of its own (its
 * heatmap), while a referrer or a browser has nowhere to lead.
 */
function toTopItems(
  record: Record<string, number> | undefined,
  linkTo?: (key: string) => ReturnType<typeof pagesLink>,
) {
  return Object.entries(record ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_LIST_LIMIT)
    .map(([label, value]) => ({
      id: label,
      title: label,
      value,
      ...(linkTo ? { to: linkTo(label) } : {}),
    }))
}

const regionNames = computed(() => new Intl.DisplayNames([locale.value], { type: 'region' }))

/** Rollup keys are ISO codes but historical map entries can be anything, and
 * `DisplayNames.of` throws on a malformed region code. */
function countryLabel(code: string): string {
  try {
    return regionNames.value.of(code) ?? code
  }
  catch {
    return code
  }
}

const languageNames = computed(() => new Intl.DisplayNames([locale.value], { type: 'language' }))

/** Same guard as countries: keys are whatever `navigator.language` reported. */
function languageLabel(tag: string): string {
  try {
    return languageNames.value.of(tag) ?? tag
  }
  catch {
    return tag
  }
}

/** Channel keys localize on the campaigns page's labels; a key minted outside
 * the known five still shows raw. */
function channelLabel(channel: string): string {
  const key = `page.marketing.campaigns.channels.${channel}`
  return te(key) ? t(key) : channel
}

const groupCards = computed(() => {
  const toPage = (path: string) =>
    pagesLink({ website: selectedId.value, path, period: period.value })
  const label = (key: string) => t(`page.marketing.overview.groups.${key}`)
  return [
    // Entry and exit are paths too, so every row leads to the page surface.
    {
      id: 'content',
      title: label('content.title'),
      stateKey: 'content_tab',
      footerLabel: label('content.view_all'),
      footerTo: pagesLink({ website: selectedId.value, period: period.value }),
      tabs: [
        { id: 'pages', label: label('content.tabs.pages'), items: toTopItems(overview.value?.topPages, toPage) },
        { id: 'entry', label: label('content.tabs.entry'), items: toTopItems(overview.value?.topEntryPages, toPage) },
        { id: 'exit', label: label('content.tabs.exit'), items: toTopItems(overview.value?.topExitPages, toPage) },
      ],
    },
    // No UTM tab: the campaigns table owns that detail, the footer leads there.
    {
      id: 'acquisition',
      title: label('acquisition.title'),
      stateKey: 'acquisition_tab',
      footerLabel: label('acquisition.view_all'),
      footerTo: campaignsLink({ website: selectedId.value, period: period.value }),
      tabs: [
        {
          id: 'channels',
          label: label('acquisition.tabs.channels'),
          items: toTopItems(overview.value?.topChannels).map(item =>
            ({ ...item, title: channelLabel(item.title) })),
        },
        { id: 'referrers', label: label('acquisition.tabs.referrers'), items: toTopItems(overview.value?.topReferrers) },
      ],
    },
    {
      id: 'audience',
      title: label('audience.title'),
      stateKey: 'audience_tab',
      tabs: [
        { id: 'browsers', label: label('audience.tabs.browsers'), items: toTopItems(overview.value?.topBrowsers) },
        {
          id: 'languages',
          label: label('audience.tabs.languages'),
          items: toTopItems(overview.value?.topLanguages).map(item =>
            ({ ...item, title: languageLabel(item.title) })),
        },
        // Without a GeoIP database the map can only ever be empty — no tab
        // at all beats a permanently empty one.
        ...(overview.value?.geoipEnabled
          ? [{
              id: 'countries',
              label: label('audience.tabs.countries'),
              items: toTopItems(overview.value?.topCountries).map(item =>
                ({ ...item, title: countryLabel(item.title) })),
            }]
          : []),
      ],
    },
    // The names behind the custom-events KPI: which CTA gets clicked.
    {
      id: 'events',
      title: label('events.title'),
      footerLabel: label('events.view_all'),
      footerTo: funnelsLink({ website: selectedId.value, period: period.value }),
      tabs: [
        { id: 'events', label: label('events.title'), items: toTopItems(overview.value?.topEvents) },
      ],
    },
  ]
})
</script>

<template>
  <div class="space-y-6 p-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold">{{ t('page.marketing.overview.title') }}</h1>
        <p class="text-sm text-muted">{{ t('page.marketing.overview.subtitle') }}</p>
      </div>
      <div class="flex items-center gap-3">
        <USelect
          v-if="websites.length > 1"
          v-model="selectedId"
          :items="websiteItems"
          class="w-56"
        />
        <UButton
          v-if="selectedId"
          icon="i-ph-code"
          color="neutral"
          variant="ghost"
          size="sm"
          :label="t('page.marketing.websites.snippet.button')"
          @click="showSnippet"
        />
        <UButton
          v-if="websites.length > 0"
          icon="i-ph-plus"
          color="neutral"
          variant="ghost"
          size="sm"
          :label="t('page.marketing.websites.create')"
          @click="createWebsite"
        />
        <DmsPeriodSelector
          :id="PERIOD_SCOPE"
          :component-id="childId('period')"
          :page-id="props.pageId"
          :default-preset="DEFAULT_PERIOD_PRESET"
          :presets="MARKETING_PERIOD_PRESETS"
          :comparisons="['none']"
          :show-range-label="false"
        />
        <UButton
          icon="i-ph-arrow-clockwise"
          color="neutral"
          variant="subtle"
          size="sm"
          :loading="loading"
          @click="loadOverview"
        />
      </div>
    </div>

    <div v-if="failed" class="flex flex-col items-start gap-3">
      <UAlert
        color="error"
        variant="subtle"
        icon="i-ph-warning-circle"
        :title="t('page.marketing.overview.error.title')"
        :description="t('page.marketing.overview.error.description')"
      />
      <UButton
        icon="i-ph-arrow-clockwise"
        :label="t('page.marketing.overview.retry')"
        color="neutral"
        variant="subtle"
        size="sm"
        @click="reload"
      />
    </div>

    <DmsMarketingNoWebsiteState
      v-else-if="!loading && websites.length === 0"
      icon="i-ph-chart-line-up"
      :title="t('page.marketing.overview.empty.title')"
      :description="t('page.marketing.overview.empty.description')"
      @create="createWebsite"
    />

    <!-- Only before the first answer: a refetch keeps the dashboard on screen
    and spins the refresh button instead. -->
    <USkeleton v-else-if="loading && !overview" class="h-96 w-full" />

    <template v-else>
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <template v-for="kpi in kpis" :key="kpi.id">
          <DmsMarketingTextKpiCard
            v-if="kpi.display !== undefined"
            :title="kpi.label"
            :value="kpi.display"
            :icon="kpi.icon"
          />
          <DmsKpiCard
            v-else
            :component-id="childId(`kpi-${kpi.id}`)"
            :page-id="props.pageId"
            variant="stat"
            :title="kpi.label"
            :icon="kpi.icon"
            :static-value="kpi.value"
            :show-delta="false"
            :value-format="kpi.format"
          />
        </template>
      </div>

      <div class="grid gap-4 lg:grid-cols-3">
        <UCard class="lg:col-span-2">
          <template #header>
            <div>
              <p class="font-medium">{{ t('page.marketing.overview.traffic.title') }}</p>
              <p class="text-sm text-muted">{{ t('page.marketing.overview.traffic.subtitle') }}</p>
            </div>
          </template>
          <DmsChart
            v-if="hasTraffic"
            :component-id="childId('traffic')"
            :page-id="props.pageId"
            type="area"
            :static-dataset="trafficSeries"
            :smooth="true"
            :show-legend="true"
            xaxis-type="datetime"
            height="300px"
          />
          <p v-else class="py-12 text-center text-sm text-muted">
            {{ t('page.marketing.overview.traffic.empty') }}
          </p>
        </UCard>

        <UCard>
          <template #header>
            <p class="font-medium">{{ t('page.marketing.overview.devices.title') }}</p>
          </template>
          <DmsChart
            v-if="deviceRecords.length > 0"
            :component-id="childId('devices')"
            :page-id="props.pageId"
            type="donut"
            :static-dataset="deviceRecords"
            height="300px"
            :show-total="true"
          />
          <p v-else class="py-12 text-center text-sm text-muted">
            {{ t('page.marketing.overview.devices.empty') }}
          </p>
        </UCard>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <DmsMarketingTopListTabsCard
          v-for="card in groupCards"
          :key="card.id"
          :title="card.title"
          :tabs="card.tabs"
          :state-key="card.stateKey"
          :empty-label="t('page.marketing.overview.groups.empty')"
          :footer-label="card.footerLabel"
          :footer-to="card.footerTo"
        />
      </div>
    </template>
  </div>
</template>
