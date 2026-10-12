<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useDmsRoute, useDmsRouter, useI18n } from '#dms/frontend-module'
import {
  MARKETING_CONTEXT_KEY,
  type ContextWebsite,
  type MarketingContextPayload,
} from '../composables/useMarketingContext'
import { useMarketingApi } from '../composables/useMarketingApi'
import { installLink } from '../composables/useMarketingRoutes'
import { formatRelativeTime, initials } from '../utils/format'
import { MAX_PERIOD_DAYS, MS_PER_DAY, PERIOD_SCOPE } from '../constants'

/**
 * The context bar of every analytics page and the gate in front of its blocks.
 *
 * The page URL is the context: a reload, a copied link or Back opens on what
 * it names, and each tab keeps its own. The period is the DMS
 * `PeriodSelector` in the bar, publishing under `periodScope`, the scope every
 * block of the page binds to: it keeps the period in the URL
 * (`?<scope>.period=…&<scope>.compare=…`, `<scope>.from`/`.to` for a custom
 * range) and the user's last choice. The website is this bar's own
 * (`?website=`): the blocks read it through a `{{query.website}}` token, so a
 * switch reads them again.
 *
 * What the URL leaves out comes from the reader's last explicit pick: the
 * selector's remembered period and the website saved server-side. Only a pick
 * in the bar writes the website, so opening a link never moves another tab.
 *
 * Its children render once the URL names one of the tenant's websites; with
 * no website at all the first-run hero takes their place, and with
 * `waitingGuide` a website still waiting for its first event shows the way
 * to its install guide instead.
 */
const props = withDefaults(
  defineProps<{
    periodScope?: string
    waitingGuide?: boolean
    componentId?: string
    pageId?: string
  }>(),
  {
    periodScope: PERIOD_SCOPE,
    waitingGuide: false,
    componentId: undefined,
    pageId: undefined,
  },
)

const PRESETS = [
  'today',
  'last-7-days',
  'last-30-days',
  'last-90-days',
  'custom',
]
const COMPARISONS = ['previous-period', 'previous-year', 'none']
const CLOCK_TICK_MS = 15_000
/**
 * How often, while the tab is shown, the blocks of a period reaching today
 * and the websites' last events are read again.
 */
const LIVE_REFRESH_MS = 60_000
/** A website is live while its last event is this recent. */
const LIVE_WINDOW_MS = 30 * 60 * 1000

const { t, locale } = useI18n()
const api = useMarketingApi()
const toast = useToast()
const route = useDmsRoute()
const router = useDmsRouter()

const presetLabels = computed(() =>
  Object.fromEntries(
    PRESETS.map((preset) => [
      preset,
      t(`page.marketing.context.presets.${preset}`),
    ]),
  ),
)

const comparisonLabels = computed(() =>
  Object.fromEntries(
    COMPARISONS.map((comparison) => [
      comparison,
      t(`page.marketing.context.comparisons.${comparison}`),
    ]),
  ),
)

const context = ref<MarketingContextPayload | null>(null)
const loading = ref(true)
const failed = ref(false)
const switching = ref(false)
const refreshToken = ref(0)

const websites = computed(() => context.value?.websites ?? [])
/** The URL's website, while it is one of the tenant's. */
const linkedId = computed(() => {
  const id = route.query.website
  return typeof id === 'string' && websites.value.some((site) => site.id === id)
    ? id
    : null
})
const selectedId = computed(
  () => linkedId.value ?? context.value?.selectedId ?? null,
)
const selected = computed<ContextWebsite | null>(
  () => websites.value.find((site) => site.id === selectedId.value) ?? null,
)

async function reload(): Promise<void> {
  loading.value = true
  failed.value = false
  try {
    context.value = await api.getContext()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

/** The websites' last events again, quietly: a failure keeps the bar as is. */
async function refreshActivity(): Promise<void> {
  try {
    context.value = await api.getContext()
  } catch {
    // The next refresh tries again.
  }
}

/**
 * The page's query as the browser has it: the period selector writes the
 * address bar first and the route catches up later, so a query built from the
 * route alone could put back the period it just replaced.
 */
function currentQuery(): Record<string, unknown> {
  if (typeof window === 'undefined') {
    return { ...route.query }
  }
  return {
    ...route.query,
    ...Object.fromEntries(new URLSearchParams(window.location.search)),
  }
}

async function select(id: string): Promise<void> {
  if (id === selectedId.value) {
    return
  }
  switching.value = true
  try {
    // Saved first, as the website of the pages opened without one; the bar
    // and the blocks follow the URL once it names it. A pick is a history
    // entry, so Back takes it back.
    context.value = await api.selectContextWebsite(id)
    await router.push({ query: { ...currentQuery(), website: id } })
  } catch {
    toast.add({
      color: 'error',
      title: t('page.marketing.context.switch_error'),
    })
    await reload()
  } finally {
    switching.value = false
  }
}

// The URL names no website, or one the tenant does not have: fill in the
// saved one, without a history entry. Watched with the query too, so a block
// rewriting the URL for its own state (the heatmap path) keeps it.
watch(
  [selectedId, () => route.query],
  ([id]) => {
    if (id && route.query.website !== id) {
      void router.replace({ query: { ...currentQuery(), website: id } })
    }
  },
  { immediate: true },
)

watch(refreshToken, () => refreshPageBlocks())

// --- Period, for the module's own reads ------------------------------------

const period = usePeriodScope(props.periodScope)

/** The last `days` days up to the end of today, before the selector registers. */
function defaultRange(days: number): { from: Date; to: Date } {
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  from.setDate(from.getDate() - (days - 1))
  const to = new Date()
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

// Read once the bar shows the selector: the scope registers with it, and a
// read before has the DMS warn about a missing scope.
const scoped = computed(() => (selected.value ? period.value : null))
const range = computed(() => scoped.value?.range ?? defaultRange(30))

const rangeDays = computed(() => {
  const { from, to } = range.value
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / MS_PER_DAY))
})

/** Days of the period, as the `Nd` window the older routes read. */
const periodDays = computed(() => `${rangeDays.value}d`)

/** A custom range longer than the routes read: only its last days are shown. */
const cutHint = computed(() =>
  rangeDays.value > MAX_PERIOD_DAYS
    ? t('page.marketing.context.range_cut', { days: MAX_PERIOD_DAYS })
    : '',
)

provide(MARKETING_CONTEXT_KEY, {
  websites,
  selected,
  period: periodDays,
  from: computed(() => range.value.from.toISOString()),
  to: computed(() => range.value.to.toISOString()),
  refreshToken,
  select,
  reload,
})

onMounted(reload)

// --- Clock -------------------------------------------------------------------
// A period reaching today follows the clock: its blocks read again every
// minute while the tab is shown, and a preset moves on at midnight. A hidden
// tab reads nothing; coming back to it catches up at once.

const now = ref(Date.now())
let lastLiveRefresh = Date.now()
/** Bumped to mount the period selector again. */
const selectorKey = ref(0)

/** The period covers the present: its counts are still moving. */
const reachesToday = computed(() => range.value.to.getTime() >= now.value)

/**
 * The DMS resolves a day preset once (only its hour presets follow the
 * clock): past midnight, a tab left open or a laptop woken up, "Today" would
 * still read yesterday. Mounting the selector again resolves its preset anew
 * from the URL, which keeps naming it.
 */
function followClock(): void {
  const state = scoped.value
  if (!state || state.preset === 'custom') {
    return
  }
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  if (state.range.to.getTime() < midnight.getTime()) {
    selectorKey.value++
  }
}

/** Refresh: the period moved on to today if a day passed, and every block reads again. */
function refresh(): void {
  followClock()
  lastLiveRefresh = Date.now()
  refreshToken.value++
  void refreshActivity()
}

function tick(): void {
  now.value = Date.now()
  if (document.visibilityState !== 'visible') {
    return
  }
  followClock()
  if (now.value - lastLiveRefresh < LIVE_REFRESH_MS) {
    return
  }
  lastLiveRefresh = now.value
  if (reachesToday.value && linkedId.value) {
    refreshPageBlocks()
  }
  void refreshActivity()
}

let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  clock = setInterval(tick, CLOCK_TICK_MS)
  document.addEventListener('visibilitychange', tick)
})
onBeforeUnmount(() => {
  if (clock) {
    clearInterval(clock)
  }
  document.removeEventListener('visibilitychange', tick)
})

// --- Bar ---------------------------------------------------------------------

/** `live` only while events are recent; a quiet site is `idle`. */
type DisplayState = ContextWebsite['state'] | 'idle'

const STATE_TONES: Record<DisplayState, string> = {
  live: 'bg-success',
  idle: 'bg-(--ui-text-muted)',
  waiting: 'bg-warning',
  paused: 'bg-(--ui-text-dimmed)',
}

function displayState(site: ContextWebsite): DisplayState {
  if (
    site.state === 'live' &&
    (site.lastActivityAt === null ||
      now.value - site.lastActivityAt > LIVE_WINDOW_MS)
  ) {
    return 'idle'
  }
  return site.state
}

function stateLine(site: ContextWebsite): string {
  const state = displayState(site)
  if ((state === 'live' || state === 'idle') && site.lastActivityAt) {
    return t(`page.marketing.context.${state}`, {
      ago: formatRelativeTime(site.lastActivityAt, now.value, locale.value),
    })
  }
  return t(`page.marketing.context.state.${site.state}`)
}

const websiteItems = computed(() => [
  websites.value.map((site) => ({
    label: site.name,
    description: site.domain,
    type: 'checkbox' as const,
    checked: site.id === selectedId.value,
    slot: 'website' as const,
    site,
    onSelect: () => void select(site.id),
  })),
  [
    {
      label: t('page.marketing.context.add_website'),
      icon: 'i-ph-plus',
      to: installLink(),
    },
  ],
])

/**
 * The statistics are kept per UTC day: where the reader's midnight is not
 * UTC's, the bar says when their days really start.
 */
const utcHint = computed(() => {
  const today = new Date(now.value)
  if (today.getTimezoneOffset() === 0) {
    return ''
  }
  const utcMidnight = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  )
  const time = new Intl.DateTimeFormat(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(utcMidnight)
  return t('page.marketing.context.utc_days', { time })
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      class="dms-card flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2"
      role="toolbar"
      :aria-label="t('page.marketing.context.label')"
    >
      <USkeleton v-if="loading && !context" class="h-7 w-72" />
      <template v-else-if="selected">
        <UDropdownMenu :items="websiteItems" :content="{ align: 'start' }">
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            trailing-icon="i-ph-caret-up-down"
            :loading="switching"
            :aria-label="t('page.marketing.context.switch_website')"
          >
            <span
              class="grid size-5 place-items-center rounded bg-primary/15 font-mono text-[10px] font-semibold text-(--ui-color-primary-800) dark:text-primary"
            >
              {{ initials(selected.name) }}
            </span>
            <span class="font-semibold">{{ selected.name }}</span>
          </UButton>
          <template #website="{ item }">
            <span
              class="grid size-6 shrink-0 place-items-center rounded bg-primary/15 font-mono text-[10px] font-semibold text-(--ui-color-primary-800) dark:text-primary"
            >
              {{ initials(item.site.name) }}
            </span>
            <span class="min-w-0 flex-1 text-left">
              <span class="block truncate text-sm font-medium text-highlighted">
                {{ item.site.name }}
              </span>
              <span
                class="flex min-w-0 items-center gap-1.5 text-xs text-dimmed"
              >
                <span
                  class="size-1.5 shrink-0 rounded-full"
                  :class="STATE_TONES[displayState(item.site)]"
                  aria-hidden="true"
                />
                <span class="truncate font-mono">{{ item.site.domain }}</span>
                <span class="shrink-0">· {{ stateLine(item.site) }}</span>
              </span>
            </span>
            <UIcon
              v-if="item.checked"
              name="i-ph-check"
              class="size-4 shrink-0 text-primary"
            />
          </template>
        </UDropdownMenu>

        <span class="flex items-center gap-2 font-mono text-xs text-muted">
          <span
            class="size-2 rounded-full"
            :class="STATE_TONES[displayState(selected)]"
            aria-hidden="true"
          />
          {{ stateLine(selected) }}
        </span>

        <span class="hidden h-5 w-px bg-(--ui-border) md:block" />

        <div class="flex flex-wrap items-center gap-2">
          <DmsPeriodSelector
            :id="periodScope"
            :key="selectorKey"
            :component-id="`${componentId ?? 'marketing-context'}-period`"
            :page-id="pageId"
            variant="segmented"
            size="xs"
            align="left"
            default-preset="last-30-days"
            default-comparison="previous-period"
            :presets="PRESETS"
            :comparisons="COMPARISONS"
            :preset-labels="presetLabels"
            :comparison-labels="comparisonLabels"
            show-range-label
          />
          <span
            v-if="cutHint"
            class="flex items-center gap-1 text-xs text-warning"
            role="status"
          >
            <UIcon name="i-ph-warning" class="size-3.5 shrink-0" />
            {{ cutHint }}
          </span>
          <UTooltip v-if="utcHint" :text="utcHint">
            <span
              class="cursor-help rounded border border-default px-1 font-mono text-[10px] text-dimmed"
              tabindex="0"
              :aria-label="utcHint"
            >
              UTC
            </span>
          </UTooltip>
        </div>

        <UButton
          class="ms-auto"
          icon="i-ph-arrow-clockwise"
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="t('page.marketing.context.refresh')"
          @click="refresh"
        />
      </template>
      <span v-else-if="!failed" class="text-sm text-muted">
        {{ t('page.marketing.context.no_website') }}
      </span>
    </div>

    <DmsEmptyState
      v-if="failed"
      variant="error"
      :title="t('page.marketing.context.error.title')"
      :description="t('page.marketing.context.error.description')"
      class="dms-card"
    >
      <template #actions>
        <UButton
          icon="i-ph-arrow-clockwise"
          color="neutral"
          variant="outline"
          size="sm"
          :label="t('page.marketing.common.retry')"
          @click="reload"
        />
      </template>
    </DmsEmptyState>

    <DmsMarketingFirstRun v-else-if="context && websites.length === 0" />

    <DmsEmptyState
      v-else-if="waitingGuide && linkedId && selected?.state === 'waiting'"
      icon="i-ph-plugs"
      :title="
        t('page.marketing.context.waiting_guide.title', { name: selected.name })
      "
      :description="t('page.marketing.context.waiting_guide.description')"
      class="dms-card"
    >
      <template #actions>
        <UButton
          icon="i-ph-book-open-text"
          size="sm"
          :label="t('page.marketing.context.waiting_guide.action')"
          @click="router.push(installLink(selected.id))"
        />
      </template>
    </DmsEmptyState>

    <slot v-else-if="linkedId" />

    <div v-else class="grid gap-4 md:grid-cols-4">
      <USkeleton v-for="index in 4" :key="index" class="h-28 rounded-xl" />
      <USkeleton class="h-72 rounded-xl md:col-span-4" />
    </div>
  </div>
</template>
