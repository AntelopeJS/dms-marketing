import { describe, expect, it } from 'vitest'
import {
  WEBSITE_LIVE_WINDOW_MS,
  websiteDisplayState,
  websiteStateLine,
  websiteStateShort,
} from '../app/utils/website-state'

const NOW = Date.UTC(2026, 9, 18, 12)
const MINUTE = 60_000
const HOUR = 60 * MINUTE

const t = (key: string, named: Record<string, unknown> = {}) =>
  named.ago ? `${key} ${String(named.ago)}` : key

describe('a website reads live', () => {
  it('only while its last event is recent', () => {
    const recent = { state: 'live' as const, lastActivityAt: NOW - MINUTE }
    expect(websiteDisplayState(recent, NOW)).toBe('live')
    const edge = {
      state: 'live' as const,
      lastActivityAt: NOW - WEBSITE_LIVE_WINDOW_MS,
    }
    expect(websiteDisplayState(edge, NOW)).toBe('live')
  })

  // QA m10: "Live · last event 7 hours ago" with a green dot.
  it('as idle, last event time kept, once it went quiet', () => {
    const quiet = { state: 'live' as const, lastActivityAt: NOW - 7 * HOUR }
    expect(websiteDisplayState(quiet, NOW)).toBe('idle')
    const line = websiteStateLine(quiet, NOW, t, 'en-GB')
    expect(line.startsWith('page.marketing.context.idle ')).toBe(true)
    expect(line).toContain('7')
  })

  it('keeps the other states as the backend sends them', () => {
    for (const state of ['imported', 'waiting', 'paused'] as const) {
      const site = {
        state,
        lastActivityAt: state === 'waiting' ? null : NOW - 7 * HOUR,
      }
      expect(websiteDisplayState(site, NOW)).toBe(state)
    }
    expect(
      websiteStateLine(
        { state: 'paused', lastActivityAt: NOW },
        NOW,
        t,
        'en-GB',
      ),
    ).toBe('page.marketing.context.state.paused')
  })
})

describe('the short state of a website', () => {
  it('is the age of its last event', () => {
    const recent = { state: 'live' as const, lastActivityAt: NOW - 12_000 }
    expect(websiteStateShort(recent, NOW, t, 'en-GB')).toBe('12 sec ago')
    // Intl spaces it with a no-break space.
    expect(websiteStateShort(recent, NOW, t, 'fr-FR')).toMatch(/^il y a 12\ss$/)
    const quiet = { state: 'live' as const, lastActivityAt: NOW - 7 * HOUR }
    expect(websiteStateShort(quiet, NOW, t, 'en-GB')).toBe('7 hr ago')
  })

  // QA: "● dans 3 s" right after events arrived, the server's clock ahead.
  it('reads just now under 5 seconds, never a time ahead', () => {
    for (const lastActivityAt of [NOW + 3_000, NOW, NOW - 4_000]) {
      const site = { state: 'live' as const, lastActivityAt }
      expect(websiteStateShort(site, NOW, t, 'fr-FR')).toBe(
        'page.marketing.context.just_now',
      )
      expect(websiteStateLine(site, NOW, t, 'fr-FR')).toBe(
        'page.marketing.context.live page.marketing.context.just_now',
      )
    }
  })

  it('is the state in a word without a last event', () => {
    expect(
      websiteStateShort(
        { state: 'waiting', lastActivityAt: null },
        NOW,
        t,
        'en-GB',
      ),
    ).toBe('page.marketing.context.state_short.waiting')
    expect(
      websiteStateShort(
        { state: 'paused', lastActivityAt: NOW },
        NOW,
        t,
        'en-GB',
      ),
    ).toBe('page.marketing.context.state_short.paused')
  })
})
