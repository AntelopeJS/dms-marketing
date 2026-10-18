<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import { useDmsRoute, useDmsRouter, useI18n } from '#dms/frontend-module'
import {
  MARKETING_CONTEXT_KEY,
  type ContextWebsite,
} from '../composables/useMarketingContext'
import { useMarketingApi } from '../composables/useMarketingApi'
import { useMarketingArrivals } from '../composables/useMarketingArrivals'
import { useMarketingContextRead } from '../composables/useMarketingReads'
import { useMarketingNow } from '../composables/useMarketingNow'
import { installLink } from '../composables/useMarketingRoutes'
import { initials, utcDayStart } from '../utils/format'
import {
  WEBSITE_STATE_DOTS,
  websiteDisplayState,
  websiteStateLine,
  websiteStateShort,
} from '../utils/website-state'
import { MAX_PERIOD_DAYS, MS_PER_DAY, PERIOD_SCOPE } from '../constants'

/**
 * The context bar of every analytics page and the gate in front of its blocks.
 *
 * The bar is the DMS `PageToolbar`, as on every page with a period or live
 * data, on one line like theirs: the website picker, its state (a dot and
 * the age of its last event, the full line in a tooltip) and the period's
 * hints lead, then the `LiveToggle` (Direct / Pause, with the time of the
 * last read) and the period on the right, at the toolbar's size. A page
 * placing the picker in a block of its own (`websitePicker: false`) has the
 * bar lead with the period's hints only while its children show: it still
 * keeps the website in the URL and fills in the remembered one, and the
 * block picks through the context the bar provides, whose `websitePicker`
 * says whether the bar draws it. The period
 * is the toolbar's: segmented short codes (1D / 7D / 30D / 90D) and the
 * calendar for a custom range, then the comparison's dropdown (vs previous
 * period, vs previous year, no comparison).
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
 * Live: every block of the page reads again on the module's arrivals topic
 * (`realtimeTopic`), through the page's Direct / Pause gate, and so does the
 * bar's own read of the websites' last events. A page holding stock blocks
 * that take no topic (the KPI cards) has the bar ask every block to read again
 * on each arrival (`refreshBlocksOnEvents`). Paused, nothing reads: the
 * arrivals count in the toggle's "N new", and Resume reads what missed any.
 *
 * Its children render once the URL names one of the tenant's websites; with
 * no website at all the first-run hero takes their place, and with
 * `waitingGuide` a website still waiting for its first event shows the way
 * to its install guide instead. A server render reads the context first: a
 * URL naming no website (or one the tenant does not have) is redirected to
 * the one saved, and the page renders on it.
 */
const props = withDefaults(
  defineProps<{
    periodScope?: string
    realtimeTopic?: string
    refreshBlocksOnEvents?: boolean
    waitingGuide?: boolean
    websitePicker?: boolean
    componentId?: string
    pageId?: string
  }>(),
  {
    periodScope: PERIOD_SCOPE,
    realtimeTopic: undefined,
    refreshBlocksOnEvents: false,
    waitingGuide: false,
    websitePicker: true,
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
/** How often the ages the bar shows ("1 min ago") move: display only. */
const CLOCK_TICK_MS = 15_000

const { t, locale } = useI18n()
const api = useMarketingApi()
const toast = useToast()
const route = useDmsRoute()
const router = useDmsRouter()
const live = usePageLive()

const comparisonLabels = computed(() =>
  Object.fromEntries(
    COMPARISONS.map((comparison) => [
      comparison,
      t(`page.marketing.context.comparisons.${comparison}`),
    ]),
  ),
)

// The websites and their last events: read again on the arrivals and the
// page's refreshes, through the page's live gate (nothing while paused).
const contextRead = useMarketingContextRead()
usePageLiveRefresh(() => void contextRead.refresh(), {
  realtimeTopic: props.realtimeTopic,
})
const context = contextRead.data
/**
 * The context could not be read, and none is shown: a failed re-read (an
 * arrival, a retry) keeps the bar as it is.
 */
const failed = computed(
  () =>
    !!contextRead.error.value &&
    contextRead.status.value !== 'pending' &&
    !context.value,
)
const switching = ref(false)

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

/** The websites and their last events again; a failure keeps the bar as is. */
const reload = (): Promise<void> => contextRead.refresh()

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
    await router.push({ query: { ...route.query, website: id } })
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
// saved one, without a history entry (a server render redirects to it).
// Watched with the query too, so a block rewriting the URL for its own state
// (the heatmap path) keeps it. Set up once the context is read.
await contextRead
watch(
  [selectedId, () => route.query],
  ([id]) => {
    if (id && route.query.website !== id) {
      void router.replace({ query: { ...route.query, website: id } })
    }
  },
  { immediate: true },
)

// --- Period --------------------------------------------------------------------

const period = usePeriodScope(props.periodScope)

// Read once the bar shows the selector: the scope registers with it, and a
// read before has the DMS warn about a missing scope.
const range = computed(() => (selected.value ? period.value?.range : null))

/** A custom range longer than the routes read: only its last days are shown. */
const cutHint = computed(() => {
  if (!range.value) {
    return ''
  }
  const { from, to } = range.value
  const days = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)
  return days > MAX_PERIOD_DAYS
    ? t('page.marketing.context.range_cut', { days: MAX_PERIOD_DAYS })
    : ''
})

// --- Gate ----------------------------------------------------------------------

/** The page's blocks render: the URL names a website ready to be read. */
const showsChildren = computed(
  () =>
    !failed.value &&
    websites.value.length > 0 &&
    !!linkedId.value &&
    !(props.waitingGuide && selected.value?.state === 'waiting'),
)

/**
 * The bar draws the website picker: always, unless the page places its own
 * in its blocks, which the bar stands in for while it hides them.
 */
const barPicker = computed(() => props.websitePicker || !showsChildren.value)

provide(MARKETING_CONTEXT_KEY, {
  websites,
  selected,
  select,
  reload,
  websitePicker: barPicker,
})

// --- Live ----------------------------------------------------------------------
// The blocks with a `realtimeTopic` read on the arrivals by themselves. The
// stock blocks that take none (the KPI cards) read when the bar asks every
// block to, through the page's live gate: in Direct on each arrival while the
// period reaches today; paused, the arrivals are only noted, and Resume asks
// once. The selector moves a day preset on at midnight, and holds it while
// paused.

const now = useMarketingNow(CLOCK_TICK_MS)

/** The period covers the present: its counts are still moving. */
const reachesToday = computed(
  () => !!range.value && range.value.to.getTime() >= now.value,
)

if (props.refreshBlocksOnEvents && props.realtimeTopic) {
  useMarketingArrivals(
    props.realtimeTopic,
    () => reachesToday.value && !!linkedId.value,
  )
}

// --- Bar ---------------------------------------------------------------------

const displayState = (site: ContextWebsite) =>
  websiteDisplayState(site, now.value)

const stateLine = (site: ContextWebsite) =>
  websiteStateLine(site, now.value, t, locale.value)

const stateShort = (site: ContextWebsite) =>
  websiteStateShort(site, now.value, t, locale.value)

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
 * UTC's, the state's tooltip says when their days really start.
 */
const utcHint = computed(() => {
  // The reader's zone: the browser's, which a server render reads from its
  // cookie.
  const time = utcDayStart(now.value, locale.value, readerTimeZone())
  return time ? t('page.marketing.context.utc_days', { time }) : ''
})

/** The full state line and the UTC days: the compact state's name. */
const stateHint = computed(() =>
  selected.value
    ? [stateLine(selected.value), utcHint.value].filter(Boolean).join('. ')
    : '',
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Without a website, the bar names none, and neither says when the
         page was read nor offers to read it again. -->
    <DmsPageToolbarBlock
      role="toolbar"
      :aria-label="t('page.marketing.context.label')"
      :show-updated-at="!!selected"
      :refresh="!!selected"
    >
      <USkeleton v-if="!context && !failed" class="h-7 w-72" />
      <template v-else-if="selected">
        <!-- One group, tighter than the toolbar's gaps: with the live toggle
             and the period, the bar stays on one line at desktop width. -->
        <div
          v-if="barPicker || cutHint"
          class="flex min-w-0 flex-wrap items-center gap-2"
        >
          <UDropdownMenu
            v-if="barPicker"
            :items="websiteItems"
            :content="{ align: 'start' }"
          >
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
                <span
                  class="block truncate text-sm font-medium text-highlighted"
                >
                  {{ item.site.name }}
                </span>
                <span
                  class="flex min-w-0 items-center gap-1.5 text-xs text-dimmed"
                >
                  <span
                    class="size-1.5 shrink-0 rounded-full"
                    :class="WEBSITE_STATE_DOTS[displayState(item.site)]"
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

          <UTooltip v-if="barPicker">
            <span
              class="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted tabular-nums"
              role="status"
              tabindex="0"
              :aria-label="stateHint"
            >
              <span
                class="size-2 rounded-full"
                :class="WEBSITE_STATE_DOTS[displayState(selected)]"
                aria-hidden="true"
              />
              <span aria-hidden="true">{{ stateShort(selected) }}</span>
            </span>
            <template #content>
              <span class="grid max-w-72 gap-1">
                <span>{{ stateLine(selected) }}</span>
                <span v-if="utcHint" class="text-dimmed">{{ utcHint }}</span>
              </span>
            </template>
          </UTooltip>

          <span
            v-if="cutHint"
            class="flex items-center gap-1 text-xs text-warning"
            role="status"
          >
            <UIcon name="i-ph-warning" class="size-3.5 shrink-0" />
            {{ cutHint }}
          </span>
        </div>

        <DmsLiveToggleBlock variant="pill" />
        <DmsPeriodSelector
          :id="periodScope"
          :component-id="`${componentId ?? 'marketing-context'}-period`"
          :page-id="pageId"
          variant="segmented"
          default-preset="last-30-days"
          default-comparison="previous-period"
          comparison-control="menu"
          range-label="relative"
          :presets="PRESETS"
          :comparisons="COMPARISONS"
          :comparison-labels="comparisonLabels"
        />
      </template>
      <span v-else-if="!failed" class="text-sm text-muted">
        {{ t('page.marketing.context.no_website') }}
      </span>
    </DmsPageToolbarBlock>

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

    <slot v-else-if="showsChildren" />

    <div v-else class="grid gap-4 md:grid-cols-4">
      <USkeleton v-for="index in 4" :key="index" class="h-28 rounded-xl" />
      <USkeleton class="h-72 rounded-xl md:col-span-4" />
    </div>
  </div>
</template>
