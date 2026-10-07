<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useDmsCookie, useI18n } from '#dms/frontend-module'
import {
  contextScopeKey,
  MARKETING_CONTEXT_KEY,
  type ContextWebsite,
  type MarketingContextPayload,
} from '../composables/useMarketingContext'
import { useMarketingApi } from '../composables/useMarketingApi'
import { installLink } from '../composables/useMarketingRoutes'
import { formatDateRange, formatRelativeTime, initials } from '../utils/format'
import { MS_PER_DAY } from '../constants'

/**
 * The context bar of every analytics page and the gate in front of its blocks.
 *
 * It owns the period (presets, comparison) through the DMS `usePeriod` and
 * publishes it under `periodScope`, the scope every block of the page binds
 * to. The published key also carries the selected website and a refresh
 * counter: the stock blocks know a period, not a website, and a changed key is
 * what makes them refetch. The selection itself is stored server-side before
 * the key changes, so the refetch reads the new website.
 *
 * Its children render only once the tenant has a website; before that the
 * first-run hero takes their place.
 */
const props = withDefaults(
  defineProps<{
    periodScope?: string
    componentId?: string
    pageId?: string
  }>(),
  { periodScope: 'dms-marketing', componentId: undefined, pageId: undefined },
)

const PRESETS = [
  'today',
  'last-7-days',
  'last-30-days',
  'last-90-days',
] as const
const COMPARISONS = ['previous-period', 'previous-year', 'none'] as const
const PRESET_LABELS: Record<(typeof PRESETS)[number], string> = {
  today: 'page.marketing.context.presets.today',
  'last-7-days': '7D',
  'last-30-days': '30D',
  'last-90-days': '90D',
}
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 365
const CLOCK_TICK_MS = 15_000

interface StoredPeriod {
  preset: (typeof PRESETS)[number]
  comparison: (typeof COMPARISONS)[number]
}

const { t, locale } = useI18n()
const api = useMarketingApi()

const stored = useDmsCookie<StoredPeriod>('dms-marketing-period', {
  default: () => ({ preset: 'last-30-days', comparison: 'previous-period' }),
  maxAge: COOKIE_MAX_AGE_S,
  sameSite: 'lax',
})

const period = usePeriod({
  defaultPreset: PRESETS.includes(stored.value.preset)
    ? stored.value.preset
    : 'last-30-days',
  defaultComparison: COMPARISONS.includes(stored.value.comparison)
    ? stored.value.comparison
    : 'previous-period',
  presets: [...PRESETS],
  comparisons: [...COMPARISONS],
})

watch([period.preset, period.comparison], ([preset, comparison]) => {
  stored.value = { preset, comparison } as StoredPeriod
})

const context = ref<MarketingContextPayload | null>(null)
const loading = ref(true)
const failed = ref(false)
const switching = ref(false)
const refreshToken = ref(0)

const websites = computed(() => context.value?.websites ?? [])
const selected = computed<ContextWebsite | null>(
  () =>
    websites.value.find((site) => site.id === context.value?.selectedId) ??
    null,
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

async function select(id: string): Promise<void> {
  if (id === context.value?.selectedId) {
    return
  }
  switching.value = true
  try {
    context.value = await api.selectContextWebsite(id)
  } finally {
    switching.value = false
  }
}

const published = computed(() => ({
  ...period.state.value,
  key: contextScopeKey(
    period.state.value.key,
    context.value?.selectedId ?? null,
    refreshToken.value,
  ),
}))

let releaseScope: (() => void) | null = null

// Published once the selection is known: a block fetching before would read
// the server's fallback website, then again the moment the selection lands.
watch(
  selected,
  (site) => {
    if (site && !releaseScope) {
      releaseScope = registerPeriodScope(props.periodScope, published)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => releaseScope?.())

const periodDays = computed(() => {
  const { from, to } = period.state.value.range
  return `${Math.max(1, Math.round((to.getTime() - from.getTime()) / MS_PER_DAY))}d`
})

provide(MARKETING_CONTEXT_KEY, {
  websites,
  selected,
  period: periodDays,
  refreshToken,
  select,
  reload,
})

onMounted(reload)

// --- Bar ---------------------------------------------------------------------

const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), CLOCK_TICK_MS)
})
onBeforeUnmount(() => clock && clearInterval(clock))

const STATE_TONES: Record<ContextWebsite['state'], string> = {
  live: 'bg-success',
  waiting: 'bg-warning',
  paused: 'bg-(--ui-text-dimmed)',
}

function stateLine(site: ContextWebsite): string {
  if (site.state === 'live' && site.lastActivityAt) {
    return t('page.marketing.context.live', {
      ago: formatRelativeTime(site.lastActivityAt, now.value, locale.value),
    })
  }
  return t(`page.marketing.context.state.${site.state}`)
}

const websiteItems = computed(() => [
  websites.value.map((site) => ({
    label: site.name,
    description: site.domain,
    avatar: undefined,
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

const presetItems = computed(() =>
  PRESETS.map((preset) => ({
    value: preset,
    label: PRESET_LABELS[preset].startsWith('page.')
      ? t(PRESET_LABELS[preset])
      : PRESET_LABELS[preset],
  })),
)

const comparisonItems = computed(() =>
  COMPARISONS.map((comparison) => ({
    value: comparison,
    label: t(`page.marketing.context.comparisons.${comparison}`),
  })),
)

const rangeLabel = computed(() => {
  const { from, to } = period.state.value.range
  return formatDateRange(from, to, locale.value)
})

const compareLabel = computed(() => {
  const range = period.state.value.compareRange
  return range ? formatDateRange(range.from, range.to, locale.value) : ''
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
              class="grid size-5 place-items-center rounded bg-primary/15 font-mono text-[10px] font-semibold text-primary"
            >
              {{ initials(selected.name) }}
            </span>
            <span class="font-semibold">{{ selected.name }}</span>
          </UButton>
          <template #website="{ item }">
            <span
              class="grid size-6 shrink-0 place-items-center rounded bg-primary/15 font-mono text-[10px] font-semibold text-primary"
            >
              {{ initials(item.site.name) }}
            </span>
            <span class="min-w-0 flex-1 text-left">
              <span class="block truncate text-sm font-medium text-highlighted">
                {{ item.site.name }}
              </span>
              <span class="block truncate font-mono text-xs text-dimmed">
                {{ item.site.domain }}
              </span>
            </span>
            <span
              class="size-2 shrink-0 rounded-full"
              :class="STATE_TONES[item.site.state as ContextWebsite['state']]"
            />
          </template>
        </UDropdownMenu>

        <span class="flex items-center gap-2 font-mono text-xs text-muted">
          <span
            class="size-2 rounded-full"
            :class="STATE_TONES[selected.state]"
          />
          {{ stateLine(selected) }}
        </span>

        <span class="hidden h-5 w-px bg-(--ui-border) md:block" />

        <DmsSegmented
          :model-value="period.preset.value"
          :items="presetItems"
          variant="mono"
          size="xs"
          :aria-label="t('page.marketing.context.period')"
          @update:model-value="
            (value: string) =>
              period.setPreset(value as (typeof PRESETS)[number])
          "
        />

        <USelect
          :model-value="period.comparison.value"
          :items="comparisonItems"
          size="xs"
          variant="ghost"
          icon="i-ph-arrows-left-right"
          class="w-48"
          :aria-label="t('page.marketing.context.comparison')"
          @update:model-value="
            (value: string) =>
              period.setComparison(value as (typeof COMPARISONS)[number])
          "
        />

        <span class="font-mono text-xs text-highlighted">
          {{ rangeLabel }}
          <template v-if="compareLabel">
            <span class="ms-2 text-primary">
              {{ t('page.marketing.context.vs') }}
            </span>
            <span class="ms-1 text-dimmed">{{ compareLabel }}</span>
          </template>
        </span>

        <UButton
          class="ms-auto"
          icon="i-ph-arrow-clockwise"
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="t('page.marketing.context.refresh')"
          @click="refreshToken++"
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

    <div v-else-if="loading && !context" class="grid gap-4 md:grid-cols-4">
      <USkeleton v-for="index in 4" :key="index" class="h-28 rounded-xl" />
      <USkeleton class="h-72 rounded-xl md:col-span-4" />
    </div>

    <DmsMarketingFirstRun v-else-if="websites.length === 0" />

    <slot v-else />
  </div>
</template>
