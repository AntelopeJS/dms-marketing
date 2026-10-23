import { describe, expect, it } from 'vitest'
import {
  heatmapDataLabel,
  normalizePagePath,
  selectedPageRow,
} from '../app/utils/heatmap'

/** A `t` that shows which key and which plural form were asked for. */
function t(key: string, named: Record<string, unknown> = {}, plural?: number) {
  const name = key.split('.').at(-1)
  if (name === 'and') {
    return `${named.first} + ${named.second}`
  }
  return `${named.count} ${name}${plural === 1 ? '' : '[n]'}`
}

describe('heatmap helpers', () => {
  it('reduces a typed path the way the tracker stores it', () => {
    expect(normalizePagePath('demo/pricing')).toBe('/demo/pricing')
    expect(normalizePagePath(' /demo/pricing?x=1#top ')).toBe('/demo/pricing')
    expect(normalizePagePath('https://shop.example/cart')).toBe('/cart')
    expect(normalizePagePath('   ')).toBeUndefined()
  })

  it('names what a reset deletes, snapshots only when there are some', () => {
    expect(heatmapDataLabel({ events: 1, snapshots: 0 }, t, 'en-GB')).toBe(
      '1 events',
    )
    expect(heatmapDataLabel({ events: 18, snapshots: 1 }, t, 'en-GB')).toBe(
      '18 events[n] + 1 snapshots',
    )
  })

  describe('selectedPageRow', () => {
    const pricing = { path: '/pricing', pageviews: 42 }
    const home = { path: '/', pageviews: 7 }

    it('takes the selected path row from the list just read', () => {
      expect(
        selectedPageRow([home, { ...pricing, pageviews: 3 }], '/pricing', pricing),
      ).toEqual({ path: '/pricing', pageviews: 3 })
    })

    it('keeps the row a filter hides from the list', () => {
      expect(selectedPageRow([home], '/pricing', pricing)).toBe(pricing)
    })

    it('keeps nothing once dropped (another workspace or other days)', () => {
      expect(selectedPageRow([home], '/pricing', undefined)).toBeUndefined()
    })

    it('never keeps the row of another path', () => {
      expect(selectedPageRow([home], '/about', pricing)).toBeUndefined()
      expect(selectedPageRow([home], undefined, pricing)).toBeUndefined()
    })
  })
})
