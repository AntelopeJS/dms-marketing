import { computed, type ComputedRef } from 'vue'

/**
 * Bridge between the DMS period selector and the marketing endpoints.
 *
 * Every marketing read takes an `Nd` window anchored on now, while the
 * selector publishes a from/to range into a scope registry. The conversion
 * belongs in one place, not least because the deep links between those views
 * carry the window as a query parameter and have to map it back onto a preset.
 */

// Local on purpose: everything this directory exports becomes a Nuxt
// auto-import, and the dms-core period layer already publishes a
// MS_PER_DAY under that same name.
const MS_PER_DAY = 86_400_000

export const DEFAULT_PERIOD_DAYS = 7
export const DEFAULT_PERIOD = `${DEFAULT_PERIOD_DAYS}d`

/** Presets every marketing surface offers, in selector order. */
export const MARKETING_PERIOD_PRESETS = [
  'today',
  'last-7-days',
  'last-30-days',
  'last-90-days',
]

const PRESET_BY_DAYS: Record<number, string> = {
  1: 'today',
  7: 'last-7-days',
  30: 'last-30-days',
  90: 'last-90-days',
}

export const DEFAULT_PERIOD_PRESET = PRESET_BY_DAYS[DEFAULT_PERIOD_DAYS]

/** Day count of an `Nd` string, or the default for anything unparseable. */
export function periodDays(period: string | undefined): number {
  const days = Number.parseInt(period ?? '', 10)
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_PERIOD_DAYS
}

/**
 * Preset matching an `Nd` window. Only exact matches map back — an arbitrary
 * window (a custom range someone linked from) falls back to the default rather
 * than silently rounding to a neighbouring preset.
 */
export function ndToPreset(period: string | undefined): string {
  if (!period) {
    return DEFAULT_PERIOD_PRESET
  }
  return PRESET_BY_DAYS[periodDays(period)] ?? DEFAULT_PERIOD_PRESET
}

/** The `Nd` window currently published by a period-selector scope. */
export function useMarketingPeriod(scope: string): ComputedRef<string> {
  const periodScope = usePeriodScope(scope)

  return computed(() => {
    const range = periodScope.value?.range
    if (!range) {
      return DEFAULT_PERIOD
    }
    const days = Math.round(
      (range.to.getTime() - range.from.getTime()) / MS_PER_DAY,
    )
    return `${Math.max(1, days)}d`
  })
}
