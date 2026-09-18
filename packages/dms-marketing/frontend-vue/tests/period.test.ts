import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PERIOD_DAYS,
  DEFAULT_PERIOD_PRESET,
  ndToPreset,
  periodDays,
} from '../app/composables/useMarketingPeriod'

describe('periodDays', () => {
  it('reads the day count of an Nd window', () => {
    expect(periodDays('30d')).toBe(30)
    expect(periodDays('1d')).toBe(1)
  })

  it('falls back to the default on anything unparseable', () => {
    for (const input of [undefined, '', 'week', '0d', '-7d']) {
      expect(periodDays(input)).toBe(DEFAULT_PERIOD_DAYS)
    }
  })
})

describe('ndToPreset', () => {
  it('maps the offered windows back onto their preset', () => {
    expect(ndToPreset('1d')).toBe('today')
    expect(ndToPreset('7d')).toBe('last-7-days')
    expect(ndToPreset('30d')).toBe('last-30-days')
    expect(ndToPreset('90d')).toBe('last-90-days')
  })

  // An arbitrary window must not silently round to a neighbouring preset.
  it('falls back to the default on a window no preset offers', () => {
    expect(ndToPreset('13d')).toBe(DEFAULT_PERIOD_PRESET)
    expect(ndToPreset(undefined)).toBe(DEFAULT_PERIOD_PRESET)
  })
})
