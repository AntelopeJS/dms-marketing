import { describe, expect, it } from 'vitest'
import { websiteCardOf } from '../app/utils/website-card'
import {
  WEBSITE_LIVE_WINDOW_MS,
  websiteDisplayState,
} from '../app/utils/website-state'

/** A row as the websites table lists it: stored fields, card merged in. */
function listedRow(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'site-1',
    name: 'Shop',
    domain: 'shop.example.com',
    trackingEnabled: true,
    snapshotsEnabled: true,
    createdAt: Date.UTC(2026, 8, 1),
    id: 'site-1',
    state: 'live',
    lastActivityAt: Date.UTC(2026, 9, 17),
    extraDomains: ['staging.example.com'],
    snapshotMaskText: true,
    sessions: 120,
    pages: 14,
    funnels: 2,
    snapshots: 5,
    sampleRate: 0.25,
    rejected: [{ hostname: 'evil.test', count: 3, lastAt: 1 }],
    ...overrides,
  }
}

describe('websiteCardOf', () => {
  it('reads a listed row into the card it draws', () => {
    expect(websiteCardOf(listedRow())).toEqual({
      id: 'site-1',
      name: 'Shop',
      domain: 'shop.example.com',
      state: 'live',
      lastActivityAt: Date.UTC(2026, 9, 17),
      extraDomains: ['staging.example.com'],
      snapshotsEnabled: true,
      snapshotMaskText: true,
      createdAt: Date.UTC(2026, 8, 1),
      sessions: 120,
      pages: 14,
      funnels: 2,
      snapshots: 5,
      sampleRate: 0.25,
      rejected: [{ hostname: 'evil.test', count: 3, lastAt: 1 }],
      dashboard: false,
    })
  })

  it('takes the id of the row and reads an ISO date', () => {
    const card = websiteCardOf(
      listedRow({ id: undefined, createdAt: '2026-09-01T00:00:00.000Z' }),
    )
    expect(card.id).toBe('site-1')
    expect(card.createdAt).toBe(Date.UTC(2026, 8, 1))
  })

  it('defaults a row read without its card', () => {
    const card = websiteCardOf({
      _id: 'site-2',
      name: 'Blog',
      domain: 'blog.example.com',
      trackingEnabled: false,
    })
    expect(card).toMatchObject({
      id: 'site-2',
      state: 'paused',
      lastActivityAt: null,
      extraDomains: [],
      snapshotsEnabled: false,
      snapshotMaskText: false,
      sessions: 0,
      snapshots: 0,
      rejected: [],
      dashboard: false,
    })
    expect(websiteCardOf({ _id: 'site-3' }).state).toBe('waiting')
  })

  it("flags the dashboard's own site only when the backend says so", () => {
    expect(websiteCardOf(listedRow({ dashboard: true })).dashboard).toBe(true)
    expect(websiteCardOf(listedRow({ dashboard: 'yes' })).dashboard).toBe(false)
  })

  it('drops what is not a host or a refused source', () => {
    const card = websiteCardOf(
      listedRow({
        extraDomains: ['a.example.com', 3, null],
        rejected: [{ hostname: 'b.test', count: 1, lastAt: 1 }, 'x', null],
        sessions: Number.NaN,
      }),
    )
    expect(card.extraDomains).toEqual(['a.example.com'])
    expect(card.rejected).toHaveLength(1)
    expect(card.sessions).toBe(0)
  })
})

// QA m10: a card read off the table shows the same state as everywhere else,
// not the backend's sticky \`live\`.
describe('a listed card', () => {
  const lastActivityAt = Date.UTC(2026, 9, 17, 12)

  it('is not shown live once its last event is over 5 minutes old', () => {
    const card = websiteCardOf(listedRow({ lastActivityAt }))
    const later = lastActivityAt + WEBSITE_LIVE_WINDOW_MS + 1
    expect(card.state).toBe('live')
    expect(websiteDisplayState(card, later)).toBe('idle')
  })

  it('is shown live while its last event is recent', () => {
    const card = websiteCardOf(listedRow({ lastActivityAt }))
    expect(websiteDisplayState(card, lastActivityAt + 60_000)).toBe('live')
  })
})
