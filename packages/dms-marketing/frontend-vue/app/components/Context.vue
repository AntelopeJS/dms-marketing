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
import { MS_PER_DAY } from '../constants'

/**
 * The context bar of every analytics page and the gate in front of its blocks.
 *
 * The period is the DMS `PeriodSelector` in the bar, publishing under
 * `periodScope`, the scope every block of the page binds to: it keeps the
 * period in the page URL (`?<scope>.period=…&<scope>.compare=…`) and the
 * user's last choice. The website is this bar's own: stored server-side per
 * member, so every route reads it without a parameter, and mirrored into the
 * URL (`?website=`) so a copied link opens on the same site. A switch asks the
 * page's blocks to read again once the selection is stored.
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
  { periodScope: 'marketing', componentId: undefined, pageId: undefined },
)

const PRESETS = ['today', 'last-7-days', 'last-30-days', 'last-90-days']
const COMPARISONS = ['previous-period', 'previous-year', 'none']
const PRESET_LABELS = {
  'last-7-days': '7D',
  'last-30-days': '30D',
  'last-90-days': '90D',
}
const CLOCK_TICK_MS = 15_000

const { t, locale } = useI18n()
const api = useMarketingApi()

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
    refreshToken.value++
  } finally {
    switching.value = false
  }
}

// Blocks know a period, not a website: a switch or the refresh button reads
// them again, the selection already stored.
watch(refreshToken, () => refreshPageBlocks())

// --- Website in the page URL -------------------------------------------------

const route = useDmsRoute()
const router = useDmsRouter()

// A link naming another website of the tenant selects it first.
watch(
  () => context.value?.selectedId,
  (selectedId) => {
    const linked = route.query.website
    if (
      selectedId &&
      typeof linked === 'string' &&
      linked !== selectedId &&
      websites.value.some((site) => site.id === linked)
    ) {
      void select(linked)
    }
  },
  { once: true },
)

// Watched with the query too: a block rewriting the URL for its own state
// (the heatmap path, the period) must not drop the website from it.
watch(
  [() => selected.value?.id, () => route.query],
  ([website]) => {
    if (website && route.query.website !== website) {
      void router.replace({ query: { ...route.query, website } })
    }
  },
  { immediate: true },
)

// --- Period, for the module's own reads -----------------------------------------

const period = usePeriodScope(props.periodScope)

/** Days of the period, as the `Nd` window the older routes read. */
const periodDays = computed(() => {
  const range = period.value?.range
  if (!range) {
    return '30d'
  }
  const days = Math.round(
    (range.to.getTime() - range.from.getTime()) / MS_PER_DAY,
  )
  return `${Math.max(1, days)}d`
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

        <DmsPeriodSelector
          :id="periodScope"
          :page-id="pageId"
          variant="segmented"
          size="xs"
          align="left"
          default-preset="last-30-days"
          default-comparison="previous-period"
          :presets="PRESETS"
          :comparisons="COMPARISONS"
          :preset-labels="PRESET_LABELS"
          show-range-label
        />

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
