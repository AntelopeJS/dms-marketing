<script setup lang="ts">
import { useI18n } from '#dms/frontend-module'
import type {
  MarketingFunnelResults,
  MarketingVariationResult,
} from '../../../composables/useMarketingApi'
import { pagesLink } from '../../../composables/useMarketingRoutes'
import { formatNumber } from '../../../utils/format'
import { fractionDigits } from '../../../constants'

/** The step-by-step card of `ExperimentReport`: each arm's share of its exposed sessions at every step, and its change against the control. */
defineProps<{
  results: MarketingFunnelResults
  arms: MarketingVariationResult[]
  armStyle: (index: number) => { chip: string; bar: string }
  stepShare: (arm: MarketingVariationResult, stepIndex: number) => number
  stepLift: (arm: MarketingVariationResult, stepIndex: number) => number | null
  inContext: (link: string) => string
  letter: (index: number) => string
  signed: (value: number, digits?: number) => string
}>()

const { t, locale } = useI18n()
</script>

<template>
  <section class="dms-card min-w-0 overflow-hidden p-0">
    <header
      class="flex items-center justify-between gap-3 border-b border-default px-4 py-3"
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
      <!-- Phone: the step on its own line, the arms under it full width.
               From md: the step beside its arms. -->
      <li
        v-for="(step, stepIndex) in results.funnel.steps"
        :key="stepIndex"
        class="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[2rem_minmax(8rem,14rem)_minmax(0,1fr)] md:gap-x-4"
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
            :title="step.value"
          >
            {{ step.value }}
          </span>
          <span class="flex items-center gap-1 text-xs text-dimmed">
            {{ t(`page.marketing.funnel.kind.${step.kind}`) }}
            <template v-if="step.kind === 'url'">
              ·
              <DmsAutoLink
                :to="inContext(pagesLink(step.value))"
                class="text-primary hover:underline"
              >
                {{ t('page.marketing.funnel.see_clicks') }}
              </DmsAutoLink>
            </template>
          </span>
        </span>
        <span class="col-span-2 flex flex-col gap-1.5 md:col-span-1">
          <span
            v-for="(arm, index) in arms"
            :key="arm.key"
            class="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2"
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
            <!-- Nobody exposed to the arm: no share to give, not 0 %. -->
            <span
              v-if="arm.exposedSessions === 0"
              class="min-w-[7.5rem] text-right font-mono text-[11px] text-dimmed"
            >
              —
            </span>
            <span
              v-else
              class="min-w-[7.5rem] text-right font-mono text-[11px] whitespace-nowrap tabular-nums"
            >
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
                  formatPercentage(
                    stepShare(arm, stepIndex) / 100,
                    locale,
                    fractionDigits(stepShare(arm, stepIndex) < 10 ? 2 : 1),
                  )
                }}
              </span>
              <span
                v-if="
                  index > 0 &&
                  stepIndex > 0 &&
                  stepLift(arm, stepIndex) !== null
                "
                class="ms-1 text-toned"
              >
                {{ signed(stepLift(arm, stepIndex) ?? 0, 0) }}
              </span>
            </span>
          </span>
        </span>
      </li>
    </ol>
    <footer
      class="flex items-start gap-1.5 border-t border-default px-4 py-2.5 text-xs text-dimmed"
    >
      <UIcon name="i-ph-info" class="mt-0.5 size-3.5 shrink-0" />
      {{ t('page.marketing.experiment.colours_note') }}
    </footer>
  </section>
</template>
