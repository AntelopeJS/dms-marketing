import { describe, expect, it } from 'vitest'
import {
  WEBSITE_STATE_DOTS,
  websiteCardOf,
  websiteStateLine,
} from '../app/utils/website-card'

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
    })
    expect(websiteCardOf({ _id: 'site-3' }).state).toBe('waiting')
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

describe('websiteStateLine', () => {
  const ago = (at: number) => `at ${at}`

  it('says how long ago a live or imported site was seen', () => {
    expect(websiteStateLine({ state: 'live', lastActivityAt: 5 }, ago)).toEqual(
      { key: 'page.marketing.context.live', params: { ago: 'at 5' } },
    )
    expect(
      websiteStateLine({ state: 'imported', lastActivityAt: 7 }, ago),
    ).toEqual({
      key: 'page.marketing.context.imported',
      params: { ago: 'at 7' },
    })
  })

  it('names the bare state otherwise', () => {
    expect(
      websiteStateLine({ state: 'waiting', lastActivityAt: null }, ago),
    ).toEqual({ key: 'page.marketing.context.state.waiting' })
    expect(
      websiteStateLine({ state: 'live', lastActivityAt: null }, ago),
    ).toEqual({ key: 'page.marketing.context.state.live' })
  })

  it('has a dot for every state', () => {
    expect(Object.keys(WEBSITE_STATE_DOTS).sort()).toEqual([
      'imported',
      'live',
      'paused',
      'waiting',
    ])
  })
})
