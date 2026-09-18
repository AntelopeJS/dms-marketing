<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '#dms/frontend-module'
import type {
  ExperimentDraft,
  ExperimentVariationDraft,
} from '../composables/useExperiment'
import { useLatestRequest } from '../composables/useLatestRequest'
import {
  useMarketingApi,
  type MarketingExperimentStatus,
  type MarketingFunnelResults,
  type MarketingFunnelStep,
  type MarketingFunnelStepResult,
  type MarketingVariationResult,
} from '../composables/useMarketingApi'
import { pagesLink } from '../composables/useMarketingRoutes'

import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Detail pane of the funnels master/detail: one funnel as a figure — centred
 * bars tied by a taper carrying the drop — drawn once over the sessions that
 * entered it, or once per arm when the funnel carries an experiment past
 * draft, with the verdict banner (control vs best arm) above and the
 * lifecycle actions in the header.
 *
 * Deletion and the status transitions are owned here (confirm included):
 * they need nothing the parent does not already hand over. Editing is only
 * emitted — the form needs the list row and the parent owns the list.
 */

/** Bars carry their own count: below this the number would not fit inside. */
const MIN_BAR_PERCENT = 12

type ArmColor = 'primary' | 'warning' | 'success'

/** Literal class names: Tailwind only ships what it can read. */
const ARM_CLASSES: Record<ArmColor, { text: string, bar: string, taper: string }> = {
  primary: { text: 'text-primary', bar: 'bg-primary', taper: 'bg-primary/20' },
  warning: { text: 'text-warning', bar: 'bg-warning', taper: 'bg-warning/20' },
  success: { text: 'text-success', bar: 'bg-success', taper: 'bg-success/20' },
}

const props = defineProps<{
  funnelId: string
  /** From the parent's list row: always names `funnelId`, while `results`
   * may still carry the previous funnel during its (slow) fetch. */
  funnelName: string
  /** The row's A/B facet, parsed by the parent; null on a plain funnel. */
  experiment: ExperimentDraft | null
  period: string
  /** Bumped by the parent after an edit: same id, new definition. */
  refreshToken?: number
}>()

const emit = defineEmits<{
  'edit': []
  'deleted': [id: string]
  'statusChanged': [status: MarketingExperimentStatus]
}>()

const api = useMarketingApi()
const { t, locale } = useI18n()
const { confirm } = useConfirm()
const toast = useToast()

// Funnel results are the slowest read in the module and the selection, the
// period and the post-edit refresh all retrigger them, so a superseded answer
// landing on the current selection is the failure mode — see useLatestRequest.
const {
  data: results,
  loading,
  failed,
  run: loadResults,
} = useLatestRequest<MarketingFunnelResults>(() =>
  api.getFunnelResults(props.funnelId, props.period),
)

watch(
  () => [props.funnelId, props.period, props.refreshToken],
  () => {
    void loadResults()
  },
  { immediate: true },
)

const status = computed(() => props.experiment?.status ?? null)

/** The per-arm read applies once the experiment has served traffic; a draft
 * still reads as the plain funnel it also is. */
const armsMode = computed(() => status.value !== null && status.value !== 'draft')

const statusMeta = computed<
  Record<MarketingExperimentStatus, { label: string, color: 'neutral' | 'success' | 'warning' }>
>(() => ({
  draft: { label: t('page.marketing.funnels.status.draft'), color: 'neutral' },
  running: { label: t('page.marketing.funnels.status.running'), color: 'success' },
  stopped: { label: t('page.marketing.funnels.status.stopped'), color: 'warning' },
}))

const variations = computed(() => props.experiment?.variations ?? [])

const totalWeight = computed(() =>
  variations.value.reduce(
    (sum, variation) => sum + Math.max(variation.weight || 0, 0),
    0,
  ),
)

function weightPercent(variation: ExperimentVariationDraft): number {
  if (totalWeight.value <= 0) {
    return Math.round(100 / Math.max(variations.value.length, 1))
  }
  return Math.round(
    (Math.max(variation.weight || 0, 0) / totalWeight.value) * 100,
  )
}

const totalExposed = computed(() =>
  (results.value?.experiment?.variations ?? []).reduce(
    (sum, variation) => sum + variation.exposedSessions,
    0,
  ),
)

function ratePercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function signedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}

/** Share of a base count; the arm's exposure or the funnel's entries. */
function share(sessions: number, base: number): number {
  return base > 0 ? sessions / base : 0
}

/**
 * The one-line read under the title. Guarded on `loading` because `results`
 * may still be the previous funnel's during a fetch — a stale count under a
 * fresh name would read as this funnel's.
 */
const metaLine = computed(() => {
  const payload = loading.value ? null : results.value
  const experiment = props.experiment
  if (!experiment) {
    if (!payload) {
      return ''
    }
    const steps = payload.computation.steps
    const entered = payload.computation.totalSessions
    const last = steps[steps.length - 1]
    return t('page.marketing.funnels.summary', {
      entered,
      rate: ((last?.conversionRate ?? 0) * 100).toFixed(1),
    }, entered)
  }
  const split = experiment.variations.map(variation => weightPercent(variation)).join('/')
  if (experiment.status === 'draft') {
    return t('page.marketing.funnels.results.meta_draft', { split })
  }
  const splitPart = t('page.marketing.funnels.results.meta_frozen', { split })
  if (!payload) {
    return splitPart
  }
  const exposedPart = t(
    'page.marketing.funnels.results.exposed',
    { count: totalExposed.value },
    totalExposed.value,
  )
  return [exposedPart, windowLabel(payload), splitPart].join(' · ')
})

function shortDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(locale.value, {
    day: 'numeric',
    month: 'short',
  })
}

/**
 * Which stretch of time the arms cover. A started split is read over its own
 * runs and not over the selected period, so the pane has to say so: the
 * period picker moves the rest of the module and leaves these numbers alone.
 * Past one run the count comes with it — the dates alone would read as an
 * unbroken stretch, and the pause inside counts for nothing.
 */
function windowLabel(payload: MarketingFunnelResults): string {
  const since = shortDate(payload.window.since)
  const span = status.value === 'stopped'
    ? t('page.marketing.funnels.results.window_stopped', {
        since,
        until: shortDate(payload.window.until),
      })
    : t('page.marketing.funnels.results.window_running', { since })
  const runs = props.experiment?.runs.length ?? 1
  if (runs < 2) {
    return span
  }
  return `${span} (${t('page.marketing.funnels.results.window_runs', { count: runs }, runs)})`
}

/**
 * Every comparison unanswered for thinness: rates and bars on a sample this
 * size would dress noise as signal, so the read degrades to raw counts.
 * Truncation also withholds every verdict, but on a large sample — there the
 * bars stay, under their own warning.
 */
const insufficient = computed(() => {
  const payload = results.value
  return payload !== null && !payload.truncated && payload.experiment !== undefined
    && payload.experiment.variations.every(variation => variation.significant === null)
})

function goalSessions(variation: MarketingVariationResult): number {
  const steps = variation.computation.steps
  return steps[steps.length - 1]?.sessions ?? 0
}

/** Arms display as positional letters (A is the control): the key is
 * definition detail — only the tooltips still carry it. */
function armLetter(index: number): string {
  return String.fromCharCode(65 + index)
}

/** Per-arm verdicts only clarify past one challenger; with a single one the
 * verdict banner already says everything a third column would repeat. */
const multiArm = computed(
  () => (results.value?.experiment?.variations.length ?? 0) > 2,
)

interface ExperimentVerdict {
  control: { key: string, label: string, rate: string }
  best: { key: string, label: string, rate: string }
  /** Two-tone bar split, each arm's share of the summed rates. */
  controlWidth: number
  bestWidth: number
  significant: boolean
  /** null when the control never converted — a ratio over zero. */
  liftLabel: string | null
  liftPositive: boolean
  confidence: string
  pLabel: string
}

/**
 * The banner's read: control against the best-converting challenger that has
 * a p-value. null while any warning state owns the pane — truncated and
 * insufficient both null every challenger's p-value, so they fall out here
 * without restating those conditions.
 */
const verdict = computed<ExperimentVerdict | null>(() => {
  const payload = results.value
  const experiment = payload?.experiment
  if (!payload || !experiment || payload.truncated || !armsMode.value) {
    return null
  }
  const controlIndex = experiment.variations.findIndex(
    variation => variation.key === experiment.control,
  )
  const control = experiment.variations[controlIndex]
  let bestIndex = -1
  experiment.variations.forEach((variation, index) => {
    if (variation.key === experiment.control || variation.pValue === null) {
      return
    }
    if (
      bestIndex === -1
      || variation.conversionRate > experiment.variations[bestIndex]!.conversionRate
    ) {
      bestIndex = index
    }
  })
  if (!control || bestIndex === -1) {
    return null
  }
  const best = experiment.variations[bestIndex]!
  const pValue = best.pValue!
  const rateSum = control.conversionRate + best.conversionRate
  return {
    control: {
      key: control.key,
      label: t('page.marketing.funnels.results.arm_control', {
        letter: armLetter(controlIndex),
      }),
      rate: ratePercent(control.conversionRate),
    },
    best: {
      key: best.key,
      label: t('page.marketing.funnels.results.arm_variation', {
        letter: armLetter(bestIndex),
      }),
      rate: ratePercent(best.conversionRate),
    },
    controlWidth: rateSum > 0 ? (control.conversionRate / rateSum) * 100 : 50,
    bestWidth: rateSum > 0 ? (best.conversionRate / rateSum) * 100 : 50,
    significant: best.significant === true,
    liftLabel: best.uplift === null ? null : signedPercent(best.uplift),
    liftPositive: (best.uplift ?? 0) >= 0,
    confidence:
      pValue < 0.001 ? '99.9%+' : `${((1 - pValue) * 100).toFixed(1)}%`,
    pLabel: pValue < 0.001 ? 'p < 0.001' : `p = ${pValue.toFixed(3)}`,
  }
})

/** One column of the figure: an arm, or the whole funnel on a plain one. */
interface ArmSource {
  key: string
  label: string
  color: ArmColor
  /** What every bar of the column is a share of. */
  base: number
  steps: MarketingFunnelStepResult[]
  endToEnd: string | null
}

interface FigureArm {
  key: string
  label: string
  color: ArmColor
  /** Flex order: with two arms the step column sits between them. */
  order: number
  /** Right-hand arm of a mirrored funnel — its own columns read outwards. */
  reversed: boolean
  /** Share of the arm's exposed sessions still there at the goal. */
  endToEnd: string | null
}

interface FigureCell {
  key: string
  color: ArmColor
  order: number
  reversed: boolean
  sessions: number
  /** Bar width as a share of its column, floored so the count fits inside. */
  width: number
  retained: string
  /** Trapezoid tying this bar to the next step's; null on the goal step. */
  taper: string | null
  /** What the next step costs this column, e.g. `−85%`. */
  drop: string | null
}

interface FigureRow {
  step: MarketingFunnelStep
  isGoal: boolean
  kindLabel: string
  /** The same loss in sessions, when a single column can own it. */
  lostLabel: string | null
  cells: FigureCell[]
}

interface Figure {
  websiteId: string
  arms: FigureArm[]
  rows: FigureRow[]
  /** Exactly two arms: the funnel mirrors around a central step column, so
   * the same step reads across both at a glance. More arms fall back to
   * plain columns — a mirror only has two sides. */
  mirrored: boolean
  /** Order of the step column itself, between the arms or before them. */
  stepOrder: number
  single: boolean
}

function barPercent(sessions: number, base: number): number {
  return Math.max(share(sessions, base) * 100, MIN_BAR_PERCENT)
}

/** The bars are centred, so the connector between two of them is an
 * isosceles trapezoid over the full column width. */
function taperPolygon(current: number, next: number): string {
  const top = (100 - current) / 2
  const bottom = (100 - next) / 2
  return `polygon(${top.toFixed(1)}% 0, ${(100 - top).toFixed(1)}% 0, ${(100 - bottom).toFixed(1)}% 100%, ${bottom.toFixed(1)}% 100%)`
}

function armSources(payload: MarketingFunnelResults): ArmSource[] {
  const experiment = armsMode.value ? payload.experiment : undefined
  if (!experiment) {
    return [{
      key: 'sessions',
      label: t('page.marketing.funnels.sessions'),
      color: 'primary',
      base: payload.computation.totalSessions,
      steps: payload.computation.steps,
      endToEnd: null,
    }]
  }
  // Bars sized against the arm's own exposure, not its funnel entries:
  // entering is an outcome the variation influences, so only exposure makes
  // arms comparable — at every step, not only at the goal.
  return experiment.variations.map((variation, index) => {
    const isControl = variation.key === experiment.control
    const letter = armLetter(index)
    return {
      key: variation.key,
      label: isControl
        ? t('page.marketing.funnels.results.arm_control', { letter })
        : t('page.marketing.funnels.results.arm_variation', { letter }),
      color: isControl ? 'warning' : 'success',
      base: variation.exposedSessions,
      steps: variation.computation.steps,
      endToEnd: ratePercent(
        share(goalSessions(variation), variation.exposedSessions),
      ),
    }
  })
}

/**
 * The funnel as one figure per column, step by step: bars tapered into the
 * next step, which puts the drop where it happens.
 */
const figure = computed<Figure | null>(() => {
  const payload = results.value
  if (!payload) {
    return null
  }
  const sources = armSources(payload)
  const single = sources.length === 1
  const mirrored = sources.length === 2
  const armOrder = (index: number) => (mirrored ? index * 2 : index + 1)
  const isReversed = (index: number) => mirrored && index === 1
  const arms = sources.map((source, index) => ({
    key: source.key,
    label: source.label,
    color: source.color,
    order: armOrder(index),
    reversed: isReversed(index),
    endToEnd: source.endToEnd,
  }))
  const steps = payload.funnel.steps
  const lastIndex = steps.length - 1
  const rows = steps.map((step, index) => {
    const isGoal = index === lastIndex
    const kind = t(`page.marketing.funnels.step_kind.${step.kind}`)
    const only = single ? sources[0]! : null
    const lost = only && !isGoal
      ? (only.steps[index]?.sessions ?? 0) - (only.steps[index + 1]?.sessions ?? 0)
      : 0
    return {
      step,
      isGoal,
      kindLabel: isGoal
        ? `${kind} · ${t('page.marketing.funnels.goal_suffix')}`
        : kind,
      lostLabel: lost > 0
        ? t('page.marketing.funnels.lost', { count: lost }, lost)
        : null,
      cells: sources.map((source, arm) => {
        const sessions = source.steps[index]?.sessions ?? 0
        const next = isGoal ? null : source.steps[index + 1]?.sessions ?? 0
        const width = barPercent(sessions, source.base)
        const dropped = next === null || sessions <= 0
          ? 0
          : Math.round((1 - next / sessions) * 100)
        return {
          key: source.key,
          color: source.color,
          order: armOrder(arm),
          reversed: isReversed(arm),
          sessions,
          width,
          retained: ratePercent(share(sessions, source.base)),
          taper: next === null
            ? null
            : taperPolygon(width, barPercent(next, source.base)),
          drop: next === null ? null : dropped > 0 ? `−${dropped}%` : '0%',
        }
      }),
    }
  })
  return {
    websiteId: payload.funnel.websiteId,
    arms,
    rows,
    mirrored,
    stepOrder: mirrored ? 1 : 0,
    single,
  }
})

/** `null` (thin sample) renders as "not enough data", not as a claim. */
function verdictOf(variation: MarketingVariationResult) {
  if (variation.significant === null) {
    return {
      label: t('page.marketing.funnels.results.insufficient'),
      color: 'neutral' as const,
    }
  }
  return variation.significant
    ? {
        label: t('page.marketing.funnels.results.significant'),
        color: 'success' as const,
      }
    : {
        label: t('page.marketing.funnels.results.not_significant'),
        color: 'neutral' as const,
      }
}

/**
 * Past one challenger the banner only judges the best arm, so every other
 * one gets its own line under the funnel — the mirrored figure has no column
 * left to carry them.
 */
const challengers = computed(() => {
  const experiment = results.value?.experiment
  if (!experiment || !multiArm.value || !armsMode.value) {
    return []
  }
  return experiment.variations.flatMap((variation, index) =>
    variation.key === experiment.control
      ? []
      : [{
          key: variation.key,
          label: t('page.marketing.funnels.results.arm_variation', {
            letter: armLetter(index),
          }),
          lift: variation.uplift === null ? null : signedPercent(variation.uplift),
          liftPositive: (variation.uplift ?? 0) >= 0,
          verdict: verdictOf(variation),
        }],
  )
})

/** draft → running ⇄ stopped; the backend enforces, this only offers. The
 * write itself belongs to the parent — it owns the list the row lives in. */
const nextStatus = computed<MarketingExperimentStatus | null>(() => {
  if (status.value === 'running') {
    return 'stopped'
  }
  return status.value === null ? null : 'running'
})

/**
 * Stopping and resuming both ask first, for opposite reasons: the stop puts
 * every visitor back on the control — a change to the live site, not just to
 * the pane — while the resume reopens a reading that was final. Starting a
 * draft asks nothing: it has nothing to undo.
 */
function confirmTransition(target: MarketingExperimentStatus): Promise<boolean> {
  if (target === 'stopped') {
    return confirm({
      title: t('page.marketing.funnels.stop.title'),
      description: t('page.marketing.funnels.stop.description'),
      confirmLabel: t('page.marketing.funnels.stop.confirm'),
      confirmColor: 'warning',
    })
  }
  if (status.value === 'stopped') {
    return confirm({
      title: t('page.marketing.funnels.resume.title'),
      description: t('page.marketing.funnels.resume.description'),
      confirmLabel: t('page.marketing.funnels.resume.confirm'),
    })
  }
  return Promise.resolve(true)
}

async function changeStatus(): Promise<void> {
  const target = nextStatus.value
  if (!target || !(await confirmTransition(target))) {
    return
  }
  emit('statusChanged', target)
}

const deleting = ref(false)

async function deleteFunnel(): Promise<void> {
  const confirmed = await confirm({
    title: t('page.marketing.funnels.delete.title'),
    description: t('page.marketing.funnels.delete.description', {
      name: props.funnelName,
    }),
    confirmLabel: t('page.marketing.funnels.delete.confirm'),
    confirmColor: 'error',
  })
  if (!confirmed) {
    return
  }
  deleting.value = true
  try {
    await api.deleteFunnel(props.funnelId)
    toast.add({
      color: 'success',
      title: t('page.marketing.funnels.delete.done'),
    })
    emit('deleted', props.funnelId)
  }
  catch {
    toast.add({
      color: 'error',
      title: t('page.marketing.funnels.delete.error'),
    })
  }
  finally {
    deleting.value = false
  }
}

/** Destructive, and one gesture away from Edit: it lives behind the overflow
 * menu rather than as another button in the header. */
const menuItems = computed<DropdownMenuItem[][]>(() => [[
  {
    label: t('page.marketing.funnels.delete.button'),
    icon: 'i-ph-trash',
    color: 'error',
    onSelect: () => {
      void deleteFunnel()
    },
  },
]])
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <p class="truncate font-medium text-highlighted">
            {{ funnelName }}
          </p>
          <UBadge
            v-if="status"
            :color="statusMeta[status].color"
            variant="subtle"
            size="sm"
          >
            <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {{ statusMeta[status].label }}
          </UBadge>
        </div>
        <p
          class="mt-1 truncate font-mono text-xs text-muted"
          :title="armsMode ? t('page.marketing.funnels.locked_hint') : undefined"
        >
          {{ metaLine }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          v-if="nextStatus === 'running'"
          :icon="status === 'stopped' ? 'i-ph-arrow-counter-clockwise' : 'i-ph-play'"
          color="success"
          variant="subtle"
          size="sm"
          :label="status === 'stopped'
            ? t('page.marketing.funnels.resume.button')
            : t('page.marketing.funnels.start')"
          @click="changeStatus"
        />
        <UButton
          v-else-if="nextStatus === 'stopped'"
          icon="i-ph-stop"
          color="warning"
          variant="subtle"
          size="sm"
          :label="t('page.marketing.funnels.stop.button')"
          @click="changeStatus"
        />
        <UButton
          icon="i-ph-pencil-simple"
          color="neutral"
          variant="subtle"
          size="sm"
          :label="t('page.marketing.funnels.edit')"
          @click="emit('edit')"
        />
        <UDropdownMenu :items="menuItems">
          <UButton
            icon="i-ph-dots-three"
            color="neutral"
            variant="subtle"
            size="sm"
            :loading="deleting"
            :aria-label="t('page.marketing.funnels.more_actions')"
          />
        </UDropdownMenu>
      </div>
    </div>

    <!-- Definition summary, drafts only: running arms read their keys and
         split off the meta line and the bars instead. -->
    <div v-if="status === 'draft'" class="flex flex-wrap items-center gap-2">
      <UBadge
        v-for="(variation, index) in variations"
        :key="variation.key"
        :label="`${variation.key} · ${weightPercent(variation)}%`"
        :color="index === 0 ? 'neutral' : 'primary'"
        variant="subtle"
        size="sm"
        class="font-mono"
      />
    </div>

    <!-- The verdict banner: the goal read as one two-tone bar, control
         against the best challenger, with the numbers a decision needs.
         Above the funnel — it is the answer, the funnel is the context. -->
    <div
      v-if="!failed && !loading && verdict"
      class="mx-auto w-full max-w-3xl border-b border-default pb-4"
    >
      <div class="flex items-baseline gap-3 font-mono text-xs text-muted">
        <span class="min-w-0 truncate" :title="verdict.control.key">
          {{ verdict.control.label }}
          <span class="font-semibold text-warning">{{ verdict.control.rate }}</span>
        </span>
        <span class="flex-1" />
        <span class="min-w-0 truncate" :title="verdict.best.key">
          <span class="font-semibold text-success">{{ verdict.best.rate }}</span>
          {{ verdict.best.label }}
        </span>
      </div>
      <div class="mt-1.5 flex h-3 overflow-hidden rounded-full bg-elevated">
        <div
          class="h-full bg-warning transition-all"
          :style="{ width: `${verdict.controlWidth}%` }"
        />
        <div
          class="h-full bg-success transition-all"
          :style="{ width: `${verdict.bestWidth}%` }"
        />
      </div>
      <div class="mt-3 flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <p class="text-xs text-muted">
            {{ t('page.marketing.funnels.results.verdict.lift') }}
          </p>
          <p
            class="mt-0.5 text-sm font-medium"
            :class="verdict.liftLabel === null
              ? 'text-muted'
              : verdict.significant
                ? (verdict.liftPositive ? 'text-success' : 'text-error')
                : 'text-warning'"
          >
            {{ verdict.liftLabel ?? '—' }}
          </p>
        </div>
        <div>
          <p class="text-xs text-muted">
            {{ t('page.marketing.funnels.results.verdict.confidence') }}
          </p>
          <p
            class="mt-0.5 text-sm font-medium"
            :class="verdict.significant ? 'text-highlighted' : 'text-warning'"
          >
            {{ verdict.confidence }} ({{ verdict.pLabel }})
          </p>
        </div>
        <div>
          <p class="text-xs text-muted">
            {{ t('page.marketing.funnels.results.verdict.sessions') }}
          </p>
          <p class="mt-0.5 text-sm font-medium text-highlighted">
            {{ totalExposed }}
          </p>
        </div>
      </div>
    </div>

    <div v-if="failed" class="flex flex-col items-start gap-3">
      <p class="text-sm text-error">
        {{ t('page.marketing.funnels.results_error') }}
      </p>
      <UButton
        icon="i-ph-arrow-clockwise"
        :label="t('page.marketing.funnels.retry')"
        color="neutral"
        variant="subtle"
        size="sm"
        @click="loadResults"
      />
    </div>
    <USkeleton v-else-if="loading" class="h-64 w-full" />
    <template v-else-if="results">
      <UAlert
        v-if="results.truncated"
        color="warning"
        variant="subtle"
        icon="i-ph-hourglass-medium"
        :title="t('page.marketing.funnels.results.truncated.title')"
        :description="t('page.marketing.funnels.results.truncated.description')"
      />
      <UAlert
        v-if="armsMode && results.experiment?.srm.mismatch"
        color="warning"
        variant="subtle"
        icon="i-ph-scales"
        :title="t('page.marketing.funnels.results.srm_warning.title')"
        :description="t('page.marketing.funnels.results.srm_warning.description')"
      />
      <UAlert
        v-if="armsMode && totalExposed === 0"
        icon="i-ph-flask"
        :title="t('page.marketing.funnels.results.empty.title')"
        :description="t('page.marketing.funnels.results.empty.description')"
      />
      <UAlert
        v-else-if="!armsMode && results.computation.totalSessions === 0"
        icon="i-ph-funnel"
        :title="t('page.marketing.funnels.no_sessions.title')"
        :description="t('page.marketing.funnels.no_sessions.description')"
      />
      <!-- No verdict anywhere: bars would dress noise as signal, so the
           read stays raw counts until the sample can answer. -->
      <template v-else-if="armsMode && insufficient && results.experiment">
        <UAlert
          icon="i-ph-hourglass"
          :title="t('page.marketing.funnels.results.insufficient_data.title')"
          :description="t('page.marketing.funnels.results.insufficient_data.description')"
        />
        <div
          class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2"
        >
          <template v-for="(variation, index) in results.experiment.variations" :key="variation.key">
            <span
              class="text-right font-mono text-xs text-highlighted"
              :title="variation.key"
            >
              {{ armLetter(index) }}
            </span>
            <p class="text-sm text-muted">
              {{
                t(
                  'page.marketing.funnels.results.exposed',
                  { count: variation.exposedSessions },
                  variation.exposedSessions,
                )
              }}
              ·
              {{
                t(
                  'page.marketing.funnels.results.reached_goal',
                  { count: goalSessions(variation) },
                  goalSessions(variation),
                )
              }}
            </p>
          </template>
        </div>
      </template>
      <!-- The figure: each bar is sized against its own column's base, so
           widths compare across columns AND down the steps, and the taper
           between two bars carries what the step costs. Two arms face each
           other around the step they share; column order is CSS-only, the
           DOM stays step-then-arms. -->
      <div v-else-if="figure" class="mx-auto w-full max-w-3xl">
        <div
          class="flex items-center gap-2.5 border-b border-default pb-2.5 font-mono text-[10px] tracking-wide"
        >
          <div class="w-44 shrink-0" :style="{ order: figure.stepOrder }" />
          <div
            v-for="arm in figure.arms"
            :key="arm.key"
            class="flex min-w-0 flex-1 items-center gap-2"
            :class="arm.reversed ? 'flex-row-reverse' : ''"
            :style="{ order: arm.order }"
          >
            <span
              class="w-12 shrink-0 text-dimmed"
              :class="arm.reversed ? 'text-left' : 'text-right'"
            >
              {{ t('page.marketing.funnels.retained') }}
            </span>
            <span
              class="min-w-0 flex-1 truncate text-center"
              :class="ARM_CLASSES[arm.color].text"
              :title="arm.key"
            >
              {{ arm.label }}
            </span>
          </div>
        </div>

        <div
          v-for="(row, index) in figure.rows"
          :key="index"
          class="flex items-start gap-2.5"
          :class="index === 0 ? 'mt-4' : ''"
        >
          <div class="w-44 shrink-0" :style="{ order: figure.stepOrder }">
            <div class="flex h-12 flex-col items-center justify-center gap-0.5">
              <span class="flex max-w-full items-center gap-1">
                <span
                  class="truncate font-mono text-xs font-medium"
                  :class="row.isGoal ? 'text-highlighted' : 'text-toned'"
                  :title="row.step.value"
                >
                  {{ row.step.value }}
                </span>
                <!-- A url step and a tracked page are matched on the same
                     key, so the step value addresses its heatmap with no
                     extra data. -->
                <UButton
                  v-if="row.step.kind === 'url'"
                  icon="i-ph-cursor-click"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  class="shrink-0"
                  :to="pagesLink({
                    website: figure.websiteId,
                    path: row.step.value,
                    period,
                  })"
                  :title="t('page.marketing.funnels.see_heatmap')"
                />
              </span>
              <span class="text-[10px] text-dimmed">{{ row.kindLabel }}</span>
            </div>
            <!-- Between two steps: the loss in sessions when one column can
                 own it, a bare connector between mirrored arms. -->
            <div
              v-if="!row.isGoal"
              class="flex h-8 items-center justify-center font-mono text-[10px] text-dimmed"
            >
              <span v-if="row.lostLabel">{{ row.lostLabel }}</span>
              <span v-else class="h-full w-px bg-accented" aria-hidden="true" />
            </div>
          </div>
          <div
            v-for="cell in row.cells"
            :key="cell.key"
            class="flex min-w-0 flex-1 items-start gap-2"
            :class="cell.reversed ? 'flex-row-reverse' : ''"
            :style="{ order: cell.order }"
          >
            <span
              class="flex h-12 w-12 shrink-0 items-center font-mono text-[11px] text-muted"
              :class="cell.reversed ? 'justify-start' : 'justify-end'"
            >
              {{ cell.retained }}
            </span>
            <div class="min-w-0 flex-1">
              <!-- The count rides inside the fill (min-w-fit keeps it
                   there), so the ink inverts with the bar instead of
                   drowning on the pane. -->
              <div
                class="relative z-10 mx-auto flex h-12 min-w-fit items-center justify-center rounded-md px-2 transition-all"
                :class="ARM_CLASSES[cell.color].bar"
                :style="{ width: `${cell.width}%` }"
              >
                <span class="font-mono text-base font-semibold text-inverted">
                  {{ cell.sessions }}
                </span>
              </div>
              <div v-if="cell.taper" class="relative -my-1 h-10">
                <div
                  class="absolute inset-0"
                  :class="ARM_CLASSES[cell.color].taper"
                  :style="{ clipPath: cell.taper }"
                  aria-hidden="true"
                />
                <div
                  class="absolute inset-0 flex items-center justify-center whitespace-nowrap font-mono text-[10px] text-muted"
                >
                  {{ cell.drop }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="!figure.single"
          class="mt-4 flex items-center gap-2.5 border-t border-default pt-3 font-mono text-[11px]"
        >
          <div class="w-44 shrink-0" :style="{ order: figure.stepOrder }" />
          <div
            v-for="arm in figure.arms"
            :key="arm.key"
            class="flex min-w-0 flex-1 items-center gap-2"
            :class="arm.reversed ? 'flex-row-reverse' : ''"
            :style="{ order: arm.order }"
          >
            <span class="w-12 shrink-0" aria-hidden="true" />
            <span
              class="min-w-0 flex-1 text-center leading-tight"
              :class="ARM_CLASSES[arm.color].text"
            >
              {{ t('page.marketing.funnels.results.end_to_end', { value: arm.endToEnd }) }}
            </span>
          </div>
        </div>

        <!-- Past one challenger the banner judges only the best arm. -->
        <div
          v-if="challengers.length > 1"
          class="mt-4 flex flex-col gap-2 border-t border-default pt-3"
        >
          <div
            v-for="challenger in challengers"
            :key="challenger.key"
            class="flex items-center gap-3"
          >
            <span
              class="w-28 shrink-0 truncate font-mono text-xs text-success"
              :title="challenger.key"
            >
              {{ challenger.label }}
            </span>
            <span
              v-if="challenger.lift"
              class="w-16 shrink-0 text-xs font-medium"
              :class="challenger.liftPositive ? 'text-success' : 'text-error'"
            >
              {{ challenger.lift }}
            </span>
            <UBadge
              :label="challenger.verdict.label"
              :color="challenger.verdict.color"
              variant="subtle"
              size="sm"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
