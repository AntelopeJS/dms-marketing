import { describe, expect, it } from 'vitest'
import {
  WEBSITE_LIVE_WINDOW_MS,
  websiteDisplayState,
  websiteStateLine,
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
