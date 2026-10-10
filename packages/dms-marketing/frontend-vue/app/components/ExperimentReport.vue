<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '#dms/frontend-module'
import type {
  MarketingFunnelResults,
  MarketingVariationResult,
} from '../composables/useMarketingApi'
import { pagesLink } from '../composables/useMarketingRoutes'
import { formatNumber, formatPercent } from '../utils/format'

/**
 * The report of a started A/B test, read over its own runs: the verdict as a
 * sentence with its next action, lift, confidence and sample size beside it;
 * the warnings that void a reading above the numbers; each arm step by step;
 * the frozen variations and the code that asks for one.
 *
 * Arms keep an identity colour everywhere (A neutral, B primary, then the
 * other tones): green and red only ever mean a verdict.
 */
const props = defineProps<{
  results: MarketingFunnelResults
  loading: boolean
}>()

const LETTER_A = 65
const PERCENT = 100
const SIGNIFICANCE_CONFIDENCE = 95
const MIN_OUTCOMES = 5

const ARM_STYLES = [
  { chip: 'bg-elevated text-toned', bar: 'bg-(--ui-text-dimmed)' },
  { chip: 'bg-primary/15 text-primary', bar: 'bg-primary' },
  { chip: 'bg-warning/15 text-warning', bar: 'bg-warning' },
  { chip: 'bg-info/15 text-info', bar: 'bg-info' },
]

const { t, locale } = useI18n()

const experiment = computed(() => props.results.experiment ?? null)
const definition = computed(() => props.results.funnel.experiment!)
const arms = computed(() => experiment.value?.variations ?? [])

function letter(index: number): string {
  return String.fromCharCode(LETTER_A + index)
}

function armStyle(index: number) {
  return ARM_STYLES[index % ARM_STYLES.length]!
}

function goalSessions(arm: MarketingVariationResult): number {
  return arm.computation.steps.at(-1)?.sessions ?? 0
}

const control = computed(() => arms.value[0] ?? null)

/** The challenger with the best rate among those that got a p-value. */
const best = computed(() => {
  const challengers = arms.value.slice(1).filter((arm) => arm.pValue !== null)
  return (
    challengers.sort((a, b) => b.conversionRate - a.conversionRate)[0] ?? null
  )
})

const bestIndex = computed(() =>
  best.value ? arms.value.indexOf(best.value) : -1,
)

const totalExposed = computed(() =>
  arms.value.reduce((sum, arm) => sum + arm.exposedSessions, 0),
)

const insufficient = computed(
  () =>
    !props.results.truncated &&
    arms.value.length > 0 &&
    arms.value.slice(1).every((arm) => arm.significant === null),
)

const srmMismatch = computed(() => experiment.value?.srm.mismatch === true)

type VerdictKind = 'winner' | 'loser' | 'flat' | 'withheld'

const verdictKind = computed<VerdictKind>(() => {
  if (
    props.results.truncated ||
    srmMismatch.value ||
    insufficient.value ||
    !best.value
  ) {
    return 'withheld'
  }
  if (!best.value.significant) {
    return 'flat'
  }
  return (best.value.uplift ?? 0) > 0 ? 'winner' : 'loser'
})

const lift = computed(() => (best.value?.uplift ?? 0) * PERCENT)
const confidence = computed(() =>
  best.value?.pValue === null || best.value?.pValue === undefined
    ? null
    : (1 - best.value.pValue) * PERCENT,
)
const goal = computed(() => props.results.funnel.steps.at(-1)?.value ?? '')

const headline = computed(() => {
  const params = {
    letter: letter(bestIndex.value),
    lift: formatPercent(Math.abs(lift.value), locale.value),
  }
  return t(`page.marketing.experiment.verdict.${verdictKind.value}`, params)
})

const explanation = computed(() => {
  if (!best.value || !control.value) {
    return ''
  }
  return t(`page.marketing.experiment.verdict.${verdictKind.value}_detail`, {
    goal: goal.value,
    best: formatPercent(best.value.conversionRate * PERCENT, locale.value, 2),
    control: formatPercent(
      control.value.conversionRate * PERCENT,
      locale.value,
      2,
    ),
    letter: letter(bestIndex.value),
    key: best.value.key,
  })
})

const maxRate = computed(() =>
  Math.max(0.0001, ...arms.value.map((arm) => arm.conversionRate)),
)

const weights = computed(() => {
  const total =
    definition.value.variations.reduce(
      (sum, arm) => sum + Math.max(arm.weight, 0),
      0,
    ) || 1
  return definition.value.variations.map(
    (arm) => (Math.max(arm.weight, 0) / total) * PERCENT,
  )
})

const srmLine = computed(() => {
  const srm = experiment.value?.srm
  if (!srm || totalExposed.value === 0) {
    return ''
  }
  const observed = arms.value
    .map((arm) =>
      formatNumber(
        (arm.exposedSessions / totalExposed.value) * PERCENT,
        locale.value,
        1,
      ),
    )
    .join(' / ')
  const expected = weights.value
    .map((weight) => formatNumber(weight, locale.value, 0))
    .join(' / ')
  return t(
    srm.mismatch
      ? 'page.marketing.experiment.srm_failed'
      : 'page.marketing.experiment.srm_passed',
    { observed, expected },
  )
})

function stepShare(arm: MarketingVariationResult, stepIndex: number): number {
  const sessions = arm.computation.steps[stepIndex]?.sessions ?? 0
  return arm.exposedSessions > 0
    ? (sessions / arm.exposedSessions) * PERCENT
    : 0
}

function stepLift(
  arm: MarketingVariationResult,
  stepIndex: number,
): number | null {
  const base = control.value ? stepShare(control.value, stepIndex) : 0
  return base > 0 ? ((stepShare(arm, stepIndex) - base) / base) * PERCENT : null
}

const snippet = computed(() =>
  [
    `const arm = await window.dmsMarketing?.variation("${definition.value.key}");`,
    ...definition.value.variations
      .slice(1)
      .map((arm) => `if (arm === "${arm.key}") { /* show ${arm.key} */ }`),
    '// null → render the control',
  ].join('\n'),
)

const withheldCounts = computed(() =>
  arms.value.map((arm, index) => ({
    key: arm.key,
    letter: letter(index),
    exposed: arm.exposedSessions,
    goal: goalSessions(arm),
  })),
)
</script>

<template>
  <div class="flex flex-col gap-4" :class="loading ? 'opacity-80' : ''">
    <DmsBanner
      v-if="srmMismatch"
      tone="error"
      icon="i-ph-scales"
      :title="t('page.marketing.experiment.srm_title')"
      :description="srmLine"
    />
    <DmsBanner
      v-if="results.truncated"
      tone="warning"
      icon="i-ph-hourglass"
      :title="t('page.marketing.experiment.truncated_title')"
      :description="t('page.marketing.experiment.truncated_description')"
    />

    <section v-if="insufficient" class="dms-card flex flex-col gap-3 p-5">
      <DmsStatusPill
        tone="neutral"
        icon="i-ph-hourglass"
        :mono="false"
        :label="t('page.marketing.experiment.insufficient_badge')"
      />
      <h2 class="text-lg font-semibold text-highlighted">
        {{ t('page.marketing.experiment.insufficient_title') }}
      </h2>
      <p class="text-sm text-muted">
        {{
          t('page.marketing.experiment.insufficient_description', {
            count: MIN_OUTCOMES,
          })
        }}
      </p>
      <ul class="flex flex-col gap-1.5">
        <li
          v-for="arm in withheldCounts"
          :key="arm.key"
          class="flex items-center gap-3 font-mono text-sm"
        >
          <span
            class="grid size-5 place-items-center rounded text-[10px] font-semibold"
            :class="armStyle(arm.letter.charCodeAt(0) - LETTER_A).chip"
          >
            {{ arm.letter }}
          </span>
          <span class="w-28 text-highlighted">{{ arm.key }}</span>
          <span class="text-muted">
            {{
              t('page.marketing.experiment.raw_counts', {
                exposed: formatNumber(arm.exposed, locale),
                goal: formatNumber(arm.goal, locale),
              })
            }}
          </span>
        </li>
      </ul>
    </section>

    <section
      v-else
      class="dms-card grid overflow-hidden p-0 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]"
    >
      <div
        class="flex flex-col gap-3 p-5"
        :class="
          verdictKind === 'winner'
            ? 'bg-success/5'
            : verdictKind === 'loser'
              ? 'bg-error/5'
              : ''
        "
      >
        <div class="flex flex-wrap items-center gap-2">
          <DmsStatusPill
            :tone="
              verdictKind === 'winner'
                ? 'success'
                : verdictKind === 'loser'
                  ? 'error'
                  : 'neutral'
            "
            :icon="
              verdictKind === 'winner' || verdictKind === 'loser'
                ? 'i-ph-check-circle'
                : 'i-ph-minus-circle'
            "
            :mono="false"
            :label="
              t(
                verdictKind === 'winner' || verdictKind === 'loser'
                  ? 'page.marketing.experiment.significant'
                  : 'page.marketing.experiment.not_significant',
                { level: SIGNIFICANCE_CONFIDENCE },
              )
            "
          />
          <DmsStatusPill
            v-if="verdictKind === 'winner' && definition.status === 'running'"
            tone="neutral"
            :mono="false"
            :label="t('page.marketing.experiment.ready')"
          />
        </div>
        <h2 class="text-xl font-semibold text-balance text-highlighted">
          {{ headline }}
        </h2>
        <p class="text-sm text-muted">{{ explanation }}</p>
        <ul class="mt-1 flex flex-col gap-2">
          <li
            v-for="(arm, index) in arms"
            :key="arm.key"
            class="grid grid-cols-[1.25rem_7rem_minmax(0,1fr)_4rem] items-center gap-3"
          >
            <span
              class="grid size-5 place-items-center rounded font-mono text-[10px] font-semibold"
              :class="armStyle(index).chip"
            >
              {{ letter(index) }}
            </span>
            <span class="truncate font-mono text-[13px] text-highlighted">
              {{ arm.key }}
            </span>
            <span class="h-2 overflow-hidden rounded-full bg-elevated">
              <span
                class="block h-full rounded-full"
                :class="armStyle(index).bar"
                :style="{ width: `${(arm.conversionRate / maxRate) * 100}%` }"
              />
            </span>
            <span
              class="text-right font-mono text-[13px] font-semibold tabular-nums text-highlighted"
            >
              {{ formatPercent(arm.conversionRate * PERCENT, locale, 2) }}
            </span>
          </li>
        </ul>
      </div>
      <div
        class="flex flex-col gap-1 border-t border-default p-5 lg:border-t-0 lg:border-l"
      >
        <DmsEyebrow :label="t('page.marketing.experiment.lift')" />
        <span
          class="text-3xl font-semibold tabular-nums"
          :class="
            verdictKind === 'winner'
              ? 'text-success'
              : verdictKind === 'loser'
                ? 'text-error'
                : 'text-highlighted'
          "
        >
          {{
            best
              ? `${lift >= 0 ? '+' : '−'}${formatPercent(Math.abs(lift), locale)}`
              : '—'
          }}
        </span>
        <span class="font-mono text-[11px] text-dimmed">
          {{
            t('page.marketing.experiment.lift_hint', {
              letter: letter(bestIndex),
            })
          }}
        </span>
      </div>
      <div
        class="flex flex-col gap-1 border-t border-default p-5 lg:border-t-0 lg:border-l"
      >
        <DmsEyebrow :label="t('page.marketing.experiment.confidence')" />
        <span class="text-3xl font-semibold tabular-nums text-highlighted">
          {{ confidence === null ? '—' : formatPercent(confidence, locale) }}
        </span>
        <span class="font-mono text-[11px] text-dimmed">
          {{
            best?.pValue != null
              ? `p = ${best.pValue.toFixed(3)} · ${t('page.marketing.experiment.test_name')}`
              : ''
          }}
        </span>
      </div>
      <div
        class="flex flex-col gap-1 border-t border-default p-5 lg:border-t-0 lg:border-l"
      >
        <DmsEyebrow :label="t('page.marketing.experiment.exposed')" />
        <span class="text-3xl font-semibold tabular-nums text-highlighted">
          {{ formatNumber(totalExposed, locale) }}
        </span>
        <span class="font-mono text-[11px] text-dimmed">
          {{
            arms
              .map(
                (arm, index) =>
                  `${formatNumber(arm.exposedSessions, locale)} ${letter(index)}`,
              )
              .join(' · ')
          }}
        </span>
      </div>
      <footer
        v-if="srmLine && !srmMismatch"
        class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-default px-5 py-2.5 text-xs text-dimmed lg:col-span-4"
      >
        <span class="flex items-center gap-1.5">
          <UIcon name="i-ph-scales" class="size-3.5" />
          {{ srmLine }}
        </span>
      </footer>
    </section>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <section class="dms-card overflow-hidden p-0">
        <header
          class="flex items-center justify-between border-b border-default px-4 py-3"
        >
          <DmsEyebrow :label="t('page.marketing.experiment.steps_title')" />
          <span class="flex gap-1">
            <span
              v-for="(arm, index) in arms"
              :key="arm.key"
              class="grid size-5 place-items-center rounded font-mono text-[10px] font-semibold"
              :class="armStyle(index).chip"
            >
              {{ letter(index) }}
            </span>
          </span>
        </header>
        <ol class="divide-y divide-default">
          <li
            v-for="(step, stepIndex) in results.funnel.steps"
            :key="stepIndex"
            class="grid grid-cols-[2rem_minmax(8rem,14rem)_minmax(0,1fr)] items-center gap-4 px-4 py-3"
          >
            <span
              class="grid size-7 place-items-center rounded-md font-mono text-xs"
              :class="
                stepIndex === results.funnel.steps.length - 1
                  ? 'bg-primary text-inverted'
                  : 'bg-elevated text-toned'
              "
            >
              <UIcon
                v-if="stepIndex === results.funnel.steps.length - 1"
                name="i-ph-flag-checkered"
                class="size-3.5"
              />
              <template v-else>{{ stepIndex + 1 }}</template>
            </span>
            <span class="min-w-0">
              <span
                class="block truncate font-mono text-[13px] text-highlighted"
              >
                {{ step.value }}
              </span>
              <span class="flex items-center gap-1 text-xs text-dimmed">
                {{ t(`page.marketing.funnel.kind.${step.kind}`) }}
                <template v-if="step.kind === 'url'">
                  ·
                  <DmsAutoLink
                    :to="pagesLink(step.value)"
                    class="text-primary hover:underline"
                  >
                    {{ t('page.marketing.funnel.see_clicks') }}
                  </DmsAutoLink>
                </template>
              </span>
            </span>
            <span class="flex flex-col gap-1.5">
              <span
                v-for="(arm, index) in arms"
                :key="arm.key"
                class="grid grid-cols-[1.25rem_minmax(0,1fr)_9rem] items-center gap-2"
              >
                <span
                  class="grid size-5 place-items-center rounded font-mono text-[10px] font-semibold"
                  :class="armStyle(index).chip"
                >
                  {{ letter(index) }}
                </span>
                <span class="h-2 overflow-hidden rounded-full bg-elevated">
                  <span
                    class="block h-full rounded-full"
                    :class="armStyle(index).bar"
                    :style="{ width: `${stepShare(arm, stepIndex)}%` }"
                  />
                </span>
                <span class="font-mono text-[11px] tabular-nums">
                  <span class="font-semibold text-highlighted">
                    {{
                      formatNumber(
                        arm.computation.steps[stepIndex]?.sessions ?? 0,
                        locale,
                      )
                    }}
                  </span>
                  <span class="ms-1 text-dimmed">
                    {{
                      formatPercent(
                        stepShare(arm, stepIndex),
                        locale,
                        stepShare(arm, stepIndex) < 10 ? 2 : 1,
                      )
                    }}
                  </span>
                  <span
                    v-if="
                      index > 0 &&
                      stepIndex > 0 &&
                      stepLift(arm, stepIndex) !== null
                    "
                    class="ms-1"
                    :class="
                      (stepLift(arm, stepIndex) ?? 0) >= 0
                        ? 'text-success'
                        : 'text-error'
                    "
                  >
                    {{ (stepLift(arm, stepIndex) ?? 0) >= 0 ? '+' : '−'
                    }}{{
                      formatNumber(
                        Math.abs(stepLift(arm, stepIndex) ?? 0),
                        locale,
                        0,
                      )
                    }}%
                  </span>
                </span>
              </span>
            </span>
          </li>
        </ol>
        <footer
          class="flex items-center gap-1.5 border-t border-default px-4 py-2.5 text-xs text-dimmed"
        >
          <UIcon name="i-ph-info" class="size-3.5" />
          {{ t('page.marketing.experiment.colours_note') }}
        </footer>
      </section>

      <div class="flex flex-col gap-4">
        <section class="dms-card p-0">
          <header
            class="flex items-center justify-between border-b border-default px-4 py-3"
          >
            <DmsEyebrow :label="t('page.marketing.experiment.variations')" />
            <DmsStatusPill
              size="sm"
              icon="i-ph-lock-simple"
              :mono="false"
              :label="t('page.marketing.experiment.frozen')"
            />
          </header>
          <ul class="flex flex-col gap-2 px-4 py-3">
            <li
              v-for="(arm, index) in definition.variations"
              :key="arm.key"
              class="flex items-center gap-3"
            >
              <span
                class="grid size-5 place-items-center rounded font-mono text-[10px] font-semibold"
                :class="armStyle(index).chip"
              >
                {{ letter(index) }}
              </span>
              <span class="font-mono text-sm text-highlighted">
                {{ arm.key }}
              </span>
              <span
                v-if="index === 0"
                class="font-mono text-[11px] text-dimmed"
              >
                {{ t('page.marketing.experiment.control_arm') }}
              </span>
              <span class="ms-auto font-mono text-sm text-muted">
                {{ formatPercent(weights[index] ?? 0, locale, 0) }}
              </span>
            </li>
          </ul>
        </section>
        <section class="dms-card p-0">
          <header class="border-b border-default px-4 py-3">
            <DmsEyebrow :label="t('page.marketing.experiment.on_site')" />
          </header>
          <div class="p-4">
            <div class="overflow-hidden rounded-lg border border-default">
              <div
                class="flex items-center justify-between border-b border-default px-3 py-1.5"
              >
                <DmsEyebrow label="JavaScript" />
                <DmsCopyButton :value="snippet" />
              </div>
              <pre
                class="px-3 py-2.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-toned"
                >{{ snippet }}</pre>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
