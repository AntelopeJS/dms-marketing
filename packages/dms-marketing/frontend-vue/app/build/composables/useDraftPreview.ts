import { computed, watch, onBeforeUnmount } from 'vue'
import {
  isWindowHours,
  MAX_STEP_VALUE_LENGTH,
  splitSampleSize,
} from '../../utils/funnel-draft'
import { useLatestRequest } from '../../composables/useLatestRequest'
import { type MarketingFunnelPreview } from '../../composables/useMarketingApi'
import { type StepDraft } from '../types/funnelBuilder'
import { normalizeFunnelStepPath } from '../../utils/step-path'
import { fractionDigits } from '../../constants'
import { formatNumber } from '../../utils/format'
import type { ComputedRef, Ref } from 'vue'
import type { useI18n } from '#dms/frontend-module'
import type { useMarketingApi } from '../../composables/useMarketingApi'
import type { VariationDraft } from '../types/funnelBuilder'

/** The live preview of `FunnelBuilder`'s draft: read again, debounced, as its steps, window or site change, and the counts, hints and sample size drawn from it. */
export function useDraftPreview(
  steps: Ref<StepDraft[]>,
  windowHours: Ref<number | string>,
  websiteId: Ref<string>,
  api: ReturnType<typeof useMarketingApi>,
  PREVIEW_DEBOUNCE_MS: number,
  t: ReturnType<typeof useI18n>['t'],
  PERCENT: number,
  locale: ReturnType<typeof useI18n>['locale'],
  MINIMUM_DETECTABLE_LIFT: number,
  variations: Ref<VariationDraft[]>,
  frozen: ComputedRef<boolean>,
  MIN_MONTHS_SHOWN: number,
) {
  const validSteps = computed(() =>
    steps.value
      .map((step) => ({ kind: step.kind, value: step.value.trim() }))
      .filter((step) => step.value !== ''),
  )

  /** Where each filled step sits in the preview, which skips the empty ones —
   * by position, so a step repeated later reads its own count. */
  const previewIndex = computed(() => {
    const index = new Map<number, number>()
    for (const step of steps.value) {
      if (step.value.trim() !== '') {
        index.set(step.uid, index.size)
      }
    }
    return index
  })

  /** The preview scores what the server would accept, nothing else. */
  const previewable = computed(
    () =>
      isWindowHours(windowHours.value) &&
      validSteps.value.every(
        (step) => step.value.length <= MAX_STEP_VALUE_LENGTH,
      ),
  )

  const {
    data: preview,
    loading: previewing,
    failed: previewFailed,
    run: runPreview,
  } = useLatestRequest<MarketingFunnelPreview>(() =>
    websiteId.value && validSteps.value.length > 0 && previewable.value
      ? api.previewFunnel(
          websiteId.value,
          validSteps.value,
          windowHours.value as number,
        )
      : null,
  )

  let previewTimer: ReturnType<typeof setTimeout> | null = null

  watch(
    [validSteps, windowHours, websiteId],
    () => {
      if (previewTimer) {
        clearTimeout(previewTimer)
      }
      previewTimer = setTimeout(() => void runPreview(), PREVIEW_DEBOUNCE_MS)
    },
    { deep: true, immediate: true },
  )

  onBeforeUnmount(() => previewTimer && clearTimeout(previewTimer))

  function previewCount(step: StepDraft): number | null {
    const index = previewIndex.value.get(step.uid)
    return index === undefined
      ? null
      : (preview.value?.computation.steps[index]?.sessions ?? null)
  }

  const previewRows = computed(() => preview.value?.computation.steps ?? [])

  /** Under a step: the path a pasted URL is matched as, or a step the site
   * never sent over the preview's 30 days (unless the read hit its cap). */
  function stepHint(
    step: StepDraft,
  ): { text: string; warning: boolean } | null {
    const value = step.value.trim()
    if (!value) {
      return null
    }
    const index = previewIndex.value.get(step.uid)
    const row = index === undefined ? undefined : previewRows.value[index]
    if (
      row &&
      row.matches === 0 &&
      (preview.value?.computation.events ?? 0) > 0 &&
      !preview.value?.truncated
    ) {
      return { text: t('page.marketing.builder.step_unseen'), warning: true }
    }
    if (step.kind === 'url') {
      const path = normalizeFunnelStepPath(value)
      if (path !== value) {
        return {
          text: t('page.marketing.builder.step_matched_as', { path }),
          warning: false,
        }
      }
    }
    return null
  }

  const entered = computed(() => previewRows.value[0]?.sessions ?? 0)
  const converted = computed(() => previewRows.value.at(-1)?.sessions ?? 0)
  const endToEnd = computed(() =>
    entered.value > 0 ? (converted.value / entered.value) * PERCENT : null,
  )

  /** Share of the previous step's sessions that reached this one. */
  function stepRate(index: number): string | null {
    const before = previewRows.value[index - 1]?.sessions ?? 0
    if (index === 0 || before <= 0) {
      return null
    }
    return String(
      formatPercentage(
        previewRows.value[index]!.sessions / before,
        locale.value,
        fractionDigits(0),
      ),
    )
  }

  /** How long the split would need, at the traffic the preview measured (the
   * preview covers 30 days, so its entered sessions are a month's). Moot once
   * the test has started: the arms can no longer change. */
  const sampleHint = computed(() => {
    const rate = entered.value > 0 ? converted.value / entered.value : 0
    const total = splitSampleSize(
      rate,
      MINIMUM_DETECTABLE_LIFT,
      variations.value.map((arm) => arm.weight),
    )
    if (frozen.value || total === null) {
      return null
    }
    const months = total / entered.value
    const duration =
      months < MIN_MONTHS_SHOWN
        ? t('page.marketing.builder.months_under', {
            months: formatNumber(MIN_MONTHS_SHOWN, locale.value, 1),
          })
        : t(
            'page.marketing.builder.months',
            {
              months: formatNumber(months, locale.value, months < 1 ? 1 : 0),
            },
            months <= 1 ? 1 : 2,
          )
    return {
      total: formatNumber(Math.round(total), locale.value),
      rate: formatPercentage(rate, locale.value, fractionDigits(1)),
      duration,
      tooSmall: months > 3,
    }
  })

  return {
    validSteps,
    previewable,
    preview,
    previewing,
    previewFailed,
    previewCount,
    previewRows,
    stepHint,
    entered,
    endToEnd,
    stepRate,
    sampleHint,
  }
}
