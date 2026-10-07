<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '#dms/frontend-module'
import type { MarketingFunnelResults } from '../composables/useMarketingApi'
import { pagesLink, funnelBuilderLink } from '../composables/useMarketingRoutes'
import { formatNumber, formatPercent, formatSignedDelta } from '../utils/format'

/**
 * The report of a plain funnel: KPIs (entered, completed, end to end, the
 * biggest loss), the sessions at each step with what each transition loses,
 * where to look next and the definition.
 */
const props = defineProps<{
  results: MarketingFunnelResults
  loading: boolean
  websiteName: string
}>()

type Basis = 'entered' | 'previous'

const MIN_BAR_PERCENT = 6
const PERCENT = 100

const { t, locale } = useI18n()

const basis = ref<Basis>('entered')

const steps = computed(() => props.results.computation.steps)
const previous = computed(() => props.results.previous?.steps ?? null)
const entered = computed(() => steps.value[0]?.sessions ?? 0)
const completed = computed(() => steps.value.at(-1)?.sessions ?? 0)
const endToEnd = computed(() =>
  entered.value > 0 ? (completed.value / entered.value) * PERCENT : null,
)

const previousEntered = computed(() => previous.value?.[0]?.sessions)
const previousCompleted = computed(() => previous.value?.at(-1)?.sessions)
const previousEndToEnd = computed(() =>
  previousEntered.value
    ? ((previousCompleted.value ?? 0) / previousEntered.value) * PERCENT
    : null,
)

function change(
  current: number,
  before: number | undefined | null,
): number | null {
  return before ? ((current - before) / before) * PERCENT : null
}

interface Transition {
  index: number
  lost: number
  rate: number
}

const transitions = computed<Transition[]>(() =>
  steps.value.slice(0, -1).map((step, index) => {
    const next = steps.value[index + 1]?.sessions ?? 0
    const lost = Math.max(0, step.sessions - next)
    return {
      index,
      lost,
      rate: step.sessions > 0 ? (lost / step.sessions) * PERCENT : 0,
    }
  }),
)

const worst = computed(() =>
  transitions.value.reduce<Transition | null>(
    (best, transition) =>
      !best || transition.rate > best.rate ? transition : best,
    null,
  ),
)

function stepLabel(index: number): string {
  return steps.value[index]?.step.value ?? ''
}

const kpis = computed(() => [
  {
    id: 'entered',
    icon: 'i-ph-sign-in',
    eyebrow: t('page.marketing.funnel.kpis.entered'),
    value: formatNumber(entered.value, locale.value),
    ...trend(change(entered.value, previousEntered.value), 'percent'),
  },
  {
    id: 'completed',
    icon: 'i-ph-flag-checkered',
    eyebrow: t('page.marketing.funnel.kpis.completed'),
    value: formatNumber(completed.value, locale.value),
    ...trend(change(completed.value, previousCompleted.value), 'percent'),
  },
  {
    id: 'end-to-end',
    icon: 'i-ph-percent',
    eyebrow: t('page.marketing.funnel.kpis.end_to_end'),
    value:
      endToEnd.value === null
        ? '—'
        : formatPercent(endToEnd.value, locale.value),
    ...trend(
      endToEnd.value !== null && previousEndToEnd.value !== null
        ? endToEnd.value - previousEndToEnd.value
        : null,
      'points',
    ),
  },
  {
    id: 'biggest-loss',
    icon: 'i-ph-arrow-fat-down',
    tone: 'error' as const,
    eyebrow: t('page.marketing.funnel.kpis.biggest_loss'),
    value: worst.value ? stepLabel(worst.value.index) : '—',
    detail: worst.value
      ? t('page.marketing.funnel.lost_rate', {
          rate: formatPercent(worst.value.rate, locale.value),
          next: stepLabel(worst.value.index + 1),
        })
      : undefined,
    detailTone: 'error' as const,
  },
])

function trend(delta: number | null, unit: 'percent' | 'points') {
  if (delta === null) {
    return {}
  }
  return {
    detail: `${formatSignedDelta(delta, unit, locale.value)} · ${t('page.marketing.context.vs_previous_short')}`,
    detailTone:
      Math.abs(delta) < 0.05
        ? ('neutral' as const)
        : delta > 0
          ? ('success' as const)
          : ('error' as const),
  }
}

function barPercent(sessions: number, index: number): number {
  const base =
    basis.value === 'entered' || index === 0
      ? entered.value
      : (steps.value[index - 1]?.sessions ?? 0)
  return base > 0
    ? Math.max((sessions / base) * PERCENT, sessions > 0 ? MIN_BAR_PERCENT : 0)
    : 0
}

function shareLabel(sessions: number, index: number): string {
  const base =
    basis.value === 'entered' || index === 0
      ? entered.value
      : (steps.value[index - 1]?.sessions ?? 0)
  return base > 0
    ? formatPercent((sessions / base) * PERCENT, locale.value)
    : '—'
}

const basisItems = computed(() => [
  { value: 'entered', label: t('page.marketing.funnel.basis.entered') },
  { value: 'previous', label: t('page.marketing.funnel.basis.previous') },
])

const goalIndex = computed(() => steps.value.length - 1)

const firstDrop = computed(() => transitions.value[0] ?? null)

const isDraft = computed(
  () => props.results.funnel.experiment?.status === 'draft',
)

const definition = computed(() => props.results.funnel)
</script>

<template>
  <div class="flex flex-col gap-4">
    <DmsBanner
      v-if="isDraft"
      tone="info"
      size="sm"
      icon="i-ph-lock-simple-open"
      :title="t('page.marketing.funnel.draft_title')"
      :description="t('page.marketing.funnel.draft_description')"
    />
    <DmsBanner
      v-if="results.truncated"
      tone="warning"
      size="sm"
      icon="i-ph-hourglass"
      :title="t('page.marketing.funnel.truncated_title')"
      :description="t('page.marketing.funnel.truncated_description')"
    />

    <DmsStatGroup :items="kpis" layout="cards" :columns="4" />

    <DmsEmptyState
      v-if="entered === 0"
      icon="i-ph-funnel"
      hatched
      class="dms-card"
      :title="t('page.marketing.funnel.empty.title')"
      :description="
        t('page.marketing.funnel.empty.description', { step: stepLabel(0) })
      "
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-ph-pencil-simple"
          :label="t('page.marketing.funnel.edit_steps')"
          :to="funnelBuilderLink(definition._id)"
        />
      </template>
    </DmsEmptyState>

    <section
      v-else
      class="dms-card overflow-hidden p-0"
      :class="loading ? 'opacity-70' : ''"
    >
      <header
        class="flex items-center justify-between gap-3 border-b border-default px-4 py-3"
      >
        <DmsEyebrow :label="t('page.marketing.funnel.figure_title')" />
        <DmsSegmented v-model="basis" :items="basisItems" size="xs" />
      </header>
      <ol class="flex flex-col px-4 py-3">
        <template v-for="(row, index) in steps" :key="index">
          <li
            class="grid grid-cols-[2rem_minmax(10rem,16rem)_minmax(0,1fr)_5rem] items-center gap-4 py-2"
          >
            <span
              class="grid size-7 place-items-center rounded-md font-mono text-xs"
              :class="
                index === goalIndex
                  ? 'bg-primary text-inverted'
                  : 'bg-elevated text-toned'
              "
            >
              <UIcon
                v-if="index === goalIndex"
                name="i-ph-flag-checkered"
                class="size-3.5"
              />
              <template v-else>{{ index + 1 }}</template>
            </span>
            <span class="min-w-0">
              <span
                class="block truncate font-mono text-[13px] text-highlighted"
              >
                {{ row.step.value }}
              </span>
              <span class="flex items-center gap-1 text-xs text-dimmed">
                <UIcon
                  :name="
                    row.step.kind === 'url' ? 'i-ph-browser' : 'i-ph-lightning'
                  "
                  class="size-3"
                />
                {{ t(`page.marketing.funnel.kind.${row.step.kind}`) }}
                <template v-if="index === goalIndex">
                  · {{ t('page.marketing.funnel.goal') }}
                </template>
                <template v-if="row.step.kind === 'url'">
                  ·
                  <DmsAutoLink
                    :to="pagesLink(row.step.value)"
                    class="text-primary hover:underline"
                  >
                    {{ t('page.marketing.funnel.see_clicks') }}
                  </DmsAutoLink>
                </template>
              </span>
            </span>
            <span class="h-8 overflow-hidden rounded-md bg-elevated/60">
              <span
                class="flex h-full items-center justify-end rounded-md bg-gradient-to-r from-primary/40 to-primary px-2 font-mono text-xs font-semibold text-inverted transition-[width] duration-500"
                :style="{ width: `${barPercent(row.sessions, index)}%` }"
              >
                {{ formatNumber(row.sessions, locale) }}
              </span>
            </span>
            <span class="text-right">
              <span
                class="block font-mono text-sm font-semibold tabular-nums text-highlighted"
              >
                {{ shareLabel(row.sessions, index) }}
              </span>
              <span class="block font-mono text-[10px] text-dimmed">
                {{
                  t(
                    index === goalIndex
                      ? 'page.marketing.funnel.converted'
                      : basis === 'entered' || index === 0
                        ? 'page.marketing.funnel.of_entered'
                        : 'page.marketing.funnel.of_previous',
                  )
                }}
              </span>
            </span>
          </li>
          <li
            v-if="transitions[index]"
            class="grid grid-cols-[2rem_minmax(10rem,16rem)_minmax(0,1fr)_5rem] gap-4"
            aria-hidden="false"
          >
            <span class="mx-auto h-6 w-px bg-(--ui-border)" />
            <span />
            <span>
              <span
                class="inline-flex items-center gap-1.5 rounded border border-error/30 bg-error/10 px-2 py-0.5 font-mono text-[11px] text-error"
              >
                <UIcon name="i-ph-arrow-down" class="size-3" />
                {{
                  t('page.marketing.funnel.lost', {
                    count: formatNumber(transitions[index]!.lost, locale),
                    rate: formatPercent(transitions[index]!.rate, locale),
                  })
                }}
                <template v-if="worst && worst.index === index">
                  · {{ t('page.marketing.funnel.worst_step') }}
                </template>
              </span>
            </span>
          </li>
        </template>
      </ol>
      <footer
        class="flex items-center gap-1.5 border-t border-default px-4 py-2.5 text-xs text-dimmed"
      >
        <UIcon name="i-ph-info" class="size-3.5" />
        {{
          t('page.marketing.funnel.figure_note', {
            hours: Math.round(definition.conversionWindowMs / 3_600_000),
          })
        }}
      </footer>
    </section>

    <div class="grid gap-4 lg:grid-cols-2">
      <section class="dms-card p-0">
        <header class="border-b border-default px-4 py-3">
          <DmsEyebrow :label="t('page.marketing.funnel.next.title')" />
        </header>
        <ul class="divide-y divide-default">
          <li
            v-if="worst && worst.lost > 0"
            class="flex items-start gap-3 px-4 py-3"
          >
            <DmsIconWell icon="i-ph-browser" tone="error" size="sm" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-highlighted">
                {{
                  t('page.marketing.funnel.next.worst', {
                    rate: formatPercent(worst.rate, locale),
                    step: stepLabel(worst.index),
                  })
                }}
              </span>
              <span class="block text-xs text-muted">
                {{ t('page.marketing.funnel.next.worst_hint') }}
              </span>
            </span>
            <DmsAutoLink
              v-if="steps[worst.index]?.step.kind === 'url'"
              :to="pagesLink(stepLabel(worst.index))"
              class="font-mono text-xs text-primary hover:underline"
            >
              {{ t('page.marketing.funnel.next.heatmap') }}
            </DmsAutoLink>
          </li>
          <li
            v-if="firstDrop && firstDrop.lost > 0"
            class="flex items-start gap-3 px-4 py-3"
          >
            <DmsIconWell icon="i-ph-flask" tone="warning" size="sm" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-highlighted">
                {{
                  t('page.marketing.funnel.next.first', {
                    rate: formatPercent(firstDrop.rate, locale),
                    step: stepLabel(1),
                  })
                }}
              </span>
              <span class="block text-xs text-muted">
                {{
                  t('page.marketing.funnel.next.first_hint', {
                    step: stepLabel(0),
                  })
                }}
              </span>
            </span>
            <DmsAutoLink
              :to="funnelBuilderLink(definition._id, { split: true })"
              class="font-mono text-xs text-primary hover:underline"
            >
              {{ t('page.marketing.funnel.next.split') }}
            </DmsAutoLink>
          </li>
          <li
            v-if="!worst || worst.lost === 0"
            class="px-4 py-6 text-center text-sm text-muted"
          >
            {{ t('page.marketing.funnel.next.none') }}
          </li>
        </ul>
      </section>

      <section class="dms-card p-0">
        <header
          class="flex items-center justify-between border-b border-default px-4 py-3"
        >
          <DmsEyebrow :label="t('page.marketing.funnel.definition.title')" />
          <DmsAutoLink
            :to="funnelBuilderLink(definition._id)"
            class="text-xs font-medium text-primary hover:underline"
          >
            {{ t('page.marketing.common.edit') }}
          </DmsAutoLink>
        </header>
        <dl
          class="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-3 px-4 py-3 text-sm"
        >
          <dt class="text-muted">
            {{ t('page.marketing.funnel.definition.website') }}
          </dt>
          <dd class="text-highlighted">{{ websiteName }}</dd>
          <dt class="text-muted">
            {{ t('page.marketing.funnel.definition.steps') }}
          </dt>
          <dd class="flex flex-wrap items-center gap-1">
            <template v-for="(step, index) in definition.steps" :key="index">
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
          </dd>
          <dt class="text-muted">
            {{ t('page.marketing.funnel.definition.window') }}
          </dt>
          <dd class="text-highlighted">
            {{
              t('page.marketing.funnel.definition.window_value', {
                hours: Math.round(definition.conversionWindowMs / 3_600_000),
              })
            }}
          </dd>
        </dl>
      </section>
    </div>
  </div>
</template>
