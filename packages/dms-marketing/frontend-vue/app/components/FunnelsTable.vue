<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDmsRouter, useI18n } from '#dms/frontend-module'
import { useMarketingContext } from '../composables/useMarketingContext'
import {
  useMarketingApi,
  type MarketingFunnelStep,
  type MarketingFunnelSuggestions,
} from '../composables/useMarketingApi'
import {
  funnelBuilderLink,
  funnelLink,
} from '../composables/useMarketingRoutes'
import { formatNumber, formatPercent, formatShortDate } from '../utils/format'

/**
 * The funnels of the selected website as a table: steps, entered sessions,
 * conversion and its change, A/B status, filtered by kind. A running test
 * that reached significance is surfaced above it; an empty list proposes
 * funnels built from what the site already tracks.
 */
interface ExperimentLeader {
  key: string
  uplift: number
  significant: boolean
  confidence: number | null
}

interface FunnelExperimentSummary {
  key: string
  status: 'draft' | 'running' | 'stopped'
  variations: number
  since: number | null
  until: number | null
  leader: ExperimentLeader | null
  exposed: number
}

interface FunnelWebsite {
  id: string
  name: string
}

interface FunnelRow {
  id: string
  name: string
  kind: 'funnel' | 'ab'
  steps: MarketingFunnelStep[]
  windowHours: number
  createdAt: number | null
  entered: number
  completed: number
  conversion: number | null
  deltaPoints: number | null
  experiment: FunnelExperimentSummary | null
}

interface FunnelsResponse {
  website: FunnelWebsite
  rows: FunnelRow[]
}

const props = withDefaults(
  defineProps<{
    fetchUrl: string
    periodScope?: string
    componentId?: string
    pageId?: string
  }>(),
  { periodScope: undefined, componentId: undefined, pageId: undefined },
)

type Filter = 'all' | 'funnel' | 'ab'

const SKELETON_ROWS = 4
const VISIBLE_MIDDLE_STEPS = 1
const LETTER_A = 65

const { t, locale } = useI18n()
const router = useDmsRouter()
const api = useMarketingApi()
const context = useMarketingContext()

const { data, isLoading, error, refresh } = useChartFetch<FunnelsResponse>({
  fetchUrl: props.fetchUrl,
  periodScope: props.periodScope,
})

const filter = ref<Filter>('all')
const rows = computed(() => data.value?.rows ?? [])

const counts = computed(() => ({
  all: rows.value.length,
  funnel: rows.value.filter((row) => row.kind === 'funnel').length,
  ab: rows.value.filter((row) => row.kind === 'ab').length,
}))

const filterItems = computed(() => [
  {
    value: 'all',
    label: t('page.marketing.funnels.tabs.all'),
    count: counts.value.all,
  },
  {
    value: 'funnel',
    label: t('page.marketing.funnels.tabs.funnels'),
    icon: 'i-ph-funnel',
    count: counts.value.funnel,
  },
  {
    value: 'ab',
    label: t('page.marketing.funnels.tabs.ab'),
    icon: 'i-ph-flask',
    count: counts.value.ab,
  },
])

const visible = computed(() =>
  rows.value
    .filter((row) => filter.value === 'all' || row.kind === filter.value)
    .sort((a, b) => (b.conversion ?? -1) - (a.conversion ?? -1)),
)

const maxConversion = computed(() =>
  Math.max(1, ...rows.value.map((row) => row.conversion ?? 0)),
)

/** The running test ready to decide: significant, its leader ahead. */
const winner = computed(
  () =>
    rows.value.find(
      (row) =>
        row.experiment?.status === 'running' &&
        row.experiment.leader?.significant &&
        row.experiment.leader.uplift > 0,
    ) ?? null,
)

function stepChips(steps: MarketingFunnelStep[]) {
  if (steps.length <= VISIBLE_MIDDLE_STEPS + 2) {
    return { head: steps, hidden: 0, tail: [] as MarketingFunnelStep[] }
  }
  return {
    head: steps.slice(0, 1),
    hidden: steps.length - 2,
    tail: steps.slice(-1),
  }
}

function subline(row: FunnelRow): string {
  const experiment = row.experiment
  if (!experiment) {
    return t('page.marketing.funnels.row.plain', {
      steps: row.steps.length,
      hours: row.windowHours,
    })
  }
  const leader = experiment.leader
  if (experiment.status === 'draft') {
    return t('page.marketing.funnels.row.draft', {
      key: experiment.key,
      count: experiment.variations,
    })
  }
  if (!leader) {
    return t('page.marketing.funnels.row.no_leader', { key: experiment.key })
  }
  return t('page.marketing.funnels.row.leader', {
    key: experiment.key,
    letter: String.fromCharCode(LETTER_A + 1),
    lift: formatPercent(leader.uplift, locale.value),
  })
}

function comparison(row: FunnelRow): { label: string; tone: string } {
  const experiment = row.experiment
  if (experiment?.status === 'running' && experiment.since) {
    return {
      label: t('page.marketing.funnels.row.since', {
        date: formatShortDate(experiment.since, locale.value),
      }),
      tone: 'text-dimmed',
    }
  }
  if (
    experiment?.status === 'stopped' &&
    experiment.since &&
    experiment.until
  ) {
    return {
      label: `${formatShortDate(experiment.since, locale.value)} – ${formatShortDate(experiment.until, locale.value)}`,
      tone: 'text-dimmed',
    }
  }
  if (experiment) {
    return { label: '', tone: '' }
  }
  if (row.deltaPoints === null) {
    return {
      label: row.conversion === null ? '' : t('page.marketing.common.new'),
      tone: 'bg-elevated text-muted',
    }
  }
  const sign = row.deltaPoints > 0 ? '+' : row.deltaPoints < 0 ? '−' : '±'
  const tone =
    Math.abs(row.deltaPoints) < 0.05
      ? 'bg-elevated text-muted'
      : row.deltaPoints > 0
        ? 'bg-success/10 text-success'
        : 'bg-error/10 text-error'
  return {
    label: `${sign}${formatNumber(Math.abs(row.deltaPoints), locale.value, 1)} pt`,
    tone,
  }
}

const STATUS_TONES = {
  running: 'success',
  stopped: 'neutral',
  draft: 'info',
} as const

function open(row: FunnelRow): void {
  void router.push(funnelLink(row.id))
}

// --- Empty state: templates from what the site sends -------------------------

const suggestions = ref<MarketingFunnelSuggestions | null>(null)

watch(
  () => data.value?.rows.length,
  (count) => {
    if (count === 0) {
      void loadSuggestions()
    }
  },
)

async function loadSuggestions(): Promise<void> {
  const website = context.selected.value?.id
  if (!website || suggestions.value) {
    return
  }
  try {
    suggestions.value = await api.getFunnelSuggestions(website)
  } catch {
    suggestions.value = { pages: [], events: [] }
  }
}

interface Template {
  id: string
  title: string
  steps: MarketingFunnelStep[]
  entering: number
}

const templates = computed<Template[]>(() => {
  const pages = suggestions.value?.pages ?? []
  const events = suggestions.value?.events ?? []
  return events.slice(0, 2).map((event, index) => {
    const page = pages[index + 1] ?? pages[0]
    const steps: MarketingFunnelStep[] = page
      ? [
          { kind: 'url', value: page.value },
          { kind: 'custom', value: event.value },
        ]
      : [{ kind: 'custom', value: event.value }]
    return {
      id: `${page?.value ?? ''}-${event.value}`,
      title: event.value,
      steps,
      entering: page?.count ?? event.count,
    }
  })
})

function startFrom(template: Template | null): void {
  void router.push(funnelBuilderLink(null, { steps: template?.steps }))
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <DmsBanner
      v-if="winner && winner.experiment?.leader"
      tone="success"
      icon="i-ph-flask"
      :title="
        t('page.marketing.funnels.winner.title', {
          name: winner.name,
          lift: formatPercent(winner.experiment.leader.uplift, locale),
        })
      "
      :description="
        t('page.marketing.funnels.winner.description', {
          confidence: formatPercent(
            winner.experiment.leader.confidence ?? 0,
            locale,
          ),
          exposed: formatNumber(winner.experiment.exposed, locale),
        })
      "
    >
      <template #actions>
        <UButton
          color="success"
          size="sm"
          :label="t('page.marketing.funnels.winner.review')"
          :to="funnelLink(winner.id)"
        />
      </template>
    </DmsBanner>

    <DmsEmptyState
      v-if="error && !data"
      variant="error"
      class="dms-card"
      :title="t('page.marketing.funnels.error')"
      :description="t('page.marketing.common.data_safe')"
    >
      <template #actions>
        <UButton
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-ph-arrow-clockwise"
          :label="t('page.marketing.common.retry')"
          @click="refresh"
        />
      </template>
    </DmsEmptyState>

    <section v-else-if="data && rows.length === 0" class="dms-card p-6">
      <DmsEmptyState
        icon="i-ph-funnel"
        hatched
        :card="false"
        :title="
          t('page.marketing.funnels.empty.title', {
            website: data.website.name,
          })
        "
        :description="t('page.marketing.funnels.empty.description')"
      />
      <div class="mt-6 grid gap-3 md:grid-cols-3">
        <button
          v-for="template in templates"
          :key="template.id"
          type="button"
          class="dms-card flex flex-col items-start gap-2 p-4 text-left transition-colors hover:border-primary"
          @click="startFrom(template)"
        >
          <DmsEyebrow :label="t('page.marketing.funnels.empty.template')" />
          <span class="font-mono text-sm font-semibold text-highlighted">
            {{ template.title }}
          </span>
          <span class="flex flex-wrap items-center gap-1">
            <span
              v-for="step in template.steps"
              :key="step.value"
              class="rounded border px-1.5 py-0.5 font-mono text-[11px]"
              :class="
                step.kind === 'custom'
                  ? 'border-primary/40 text-primary'
                  : 'border-default text-toned'
              "
            >
              {{ step.value }}
            </span>
          </span>
          <span class="text-xs text-muted">
            {{
              t('page.marketing.funnels.empty.entering', {
                count: formatNumber(template.entering, locale),
              })
            }}
          </span>
        </button>
        <button
          type="button"
          class="flex flex-col items-start gap-2 rounded-xl border border-dashed border-default p-4 text-left transition-colors hover:border-primary"
          @click="startFrom(null)"
        >
          <DmsEyebrow :label="t('page.marketing.funnels.empty.blank')" />
          <span class="text-sm font-semibold text-highlighted">
            {{ t('page.marketing.funnels.empty.scratch') }}
          </span>
          <span class="text-xs text-muted">
            {{ t('page.marketing.funnels.empty.scratch_description') }}
          </span>
        </button>
      </div>
    </section>

    <section v-else class="dms-card overflow-hidden p-0">
      <header
        class="flex flex-wrap items-center gap-3 border-b border-default px-4 py-3"
      >
        <h3
          class="flex items-center gap-2 text-sm font-semibold text-highlighted"
        >
          {{ t('page.marketing.funnels.list_title') }}
          <span class="font-mono text-xs font-normal text-dimmed">
            {{ counts.all }}
          </span>
        </h3>
        <DmsSegmented
          v-model="filter"
          class="ms-auto"
          :items="filterItems"
          size="xs"
        />
      </header>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[920px] text-sm">
          <thead>
            <tr
              class="text-left font-mono text-[10px] tracking-widest text-dimmed uppercase"
            >
              <th class="px-4 py-2 font-normal">
                {{ t('page.marketing.funnels.columns.name') }}
              </th>
              <th class="px-2 py-2 font-normal">
                {{ t('page.marketing.funnels.columns.steps') }}
              </th>
              <th class="px-2 py-2 text-right font-normal">
                {{ t('page.marketing.funnels.columns.entered') }}
              </th>
              <th class="px-2 py-2 font-normal">
                {{ t('page.marketing.funnels.columns.conversion') }}
              </th>
              <th class="px-2 py-2 text-right font-normal">
                {{ t('page.marketing.funnels.columns.vs_previous') }}
              </th>
              <th class="px-4 py-2 font-normal">
                {{ t('page.marketing.funnels.columns.status') }}
              </th>
            </tr>
          </thead>
          <tbody v-if="isLoading && !data" aria-hidden="true">
            <tr
              v-for="index in SKELETON_ROWS"
              :key="index"
              class="border-t border-default"
            >
              <td class="px-4 py-3" colspan="6">
                <USkeleton class="h-5 w-full" />
              </td>
            </tr>
          </tbody>
          <tbody v-else :class="isLoading ? 'opacity-60' : ''">
            <tr
              v-for="row in visible"
              :key="row.id"
              class="cursor-pointer border-t border-default transition-colors hover:bg-elevated/50"
              tabindex="0"
              @click="open(row)"
              @keydown.enter="open(row)"
            >
              <td class="px-4 py-2.5">
                <div class="flex items-center gap-3">
                  <DmsIconWell
                    :icon="row.kind === 'ab' ? 'i-ph-flask' : 'i-ph-funnel'"
                    size="sm"
                    :tone="
                      row.experiment?.status === 'running' ? 'primary' : 'muted'
                    "
                  />
                  <span class="min-w-0">
                    <span class="block truncate font-medium text-highlighted">
                      {{ row.name }}
                    </span>
                    <span
                      class="block truncate text-xs text-dimmed"
                      :class="row.kind === 'ab' ? 'font-mono' : ''"
                    >
                      {{ subline(row) }}
                    </span>
                  </span>
                </div>
              </td>
              <td class="px-2 py-2.5">
                <span class="flex flex-wrap items-center gap-1">
                  <template
                    v-for="(step, index) in stepChips(row.steps).head"
                    :key="`h${index}`"
                  >
                    <UIcon
                      v-if="index > 0"
                      name="i-ph-caret-right"
                      class="size-3 text-dimmed"
                    />
                    <span
                      class="rounded border px-1.5 py-0.5 font-mono text-[11px]"
                      :class="
                        step.kind === 'custom'
                          ? 'border-primary/40 text-primary'
                          : 'border-default text-toned'
                      "
                    >
                      {{ step.value }}
                    </span>
                  </template>
                  <template v-if="stepChips(row.steps).hidden > 0">
                    <UIcon name="i-ph-caret-right" class="size-3 text-dimmed" />
                    <span
                      class="rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-muted"
                    >
                      +{{ stepChips(row.steps).hidden }}
                    </span>
                  </template>
                  <template
                    v-for="(step, index) in stepChips(row.steps).tail"
                    :key="`t${index}`"
                  >
                    <UIcon name="i-ph-caret-right" class="size-3 text-dimmed" />
                    <span
                      class="rounded border px-1.5 py-0.5 font-mono text-[11px]"
                      :class="
                        step.kind === 'custom'
                          ? 'border-primary/40 text-primary'
                          : 'border-default text-toned'
                      "
                    >
                      {{ step.value }}
                    </span>
                  </template>
                </span>
              </td>
              <td
                class="px-2 py-2.5 text-right font-mono tabular-nums text-highlighted"
              >
                {{ row.entered > 0 ? formatNumber(row.entered, locale) : '—' }}
              </td>
              <td class="px-2 py-2.5">
                <span
                  v-if="row.conversion !== null"
                  class="flex items-center gap-2"
                >
                  <span
                    class="w-12 text-right font-mono font-semibold tabular-nums text-highlighted"
                  >
                    {{ formatPercent(row.conversion, locale) }}
                  </span>
                  <span
                    class="h-1.5 w-20 overflow-hidden rounded-full bg-elevated"
                  >
                    <span
                      class="block h-full rounded-full bg-primary"
                      :style="{
                        width: `${(row.conversion / maxConversion) * 100}%`,
                      }"
                    />
                  </span>
                </span>
                <span v-else class="text-xs text-dimmed">
                  {{ t('page.marketing.funnels.row.no_traffic') }}
                </span>
              </td>
              <td class="px-2 py-2.5 text-right">
                <span
                  class="rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums"
                  :class="comparison(row).tone"
                >
                  {{ comparison(row).label }}
                </span>
              </td>
              <td class="px-4 py-2.5">
                <DmsStatusPill
                  v-if="row.experiment"
                  :tone="STATUS_TONES[row.experiment.status]"
                  :dot="
                    row.experiment.status === 'running' ? 'pulse' : 'static'
                  "
                  size="sm"
                  :label="
                    t(`page.marketing.funnels.status.${row.experiment.status}`)
                  "
                />
                <span v-else class="text-dimmed">—</span>
              </td>
            </tr>
            <tr v-if="visible.length === 0" class="border-t border-default">
              <td colspan="6" class="px-4 py-8 text-center text-sm text-muted">
                {{ t('page.marketing.funnels.no_match') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer
        v-if="data"
        class="flex flex-wrap items-center justify-between gap-2 border-t border-default px-4 py-2.5 text-xs text-muted"
      >
        <span>
          {{
            t('page.marketing.funnels.footer', {
              count: counts.all,
              website: data.website.name,
            })
          }}
        </span>
        <span class="flex items-center gap-1.5 text-dimmed">
          <UIcon name="i-ph-info" class="size-3.5" />
          {{ t('page.marketing.funnels.note') }}
        </span>
      </footer>
    </section>
  </div>
</template>
