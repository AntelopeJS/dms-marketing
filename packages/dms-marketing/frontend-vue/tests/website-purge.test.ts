import { describe, expect, it } from 'vitest'
import type { MarketingWebsiteDeletionImpact } from '../app/composables/useMarketingApi'
import {
  websitePurgeImpact,
  websitePurgeResult,
} from '../app/utils/website-purge'

const t = (key: string, named?: Record<string, unknown>) =>
  named ? `${key} ${JSON.stringify(named)}` : key

const IMPACT: MarketingWebsiteDeletionImpact = {
  sessions: 1200,
  pageviews: 3400,
  since: null,
  funnels: 2,
  snapshots: 3,
  heatmapEvents: 560,
}

describe('a purge confirmation', () => {
  it('counts the clicks, scrolls and snapshots of the heatmaps, and keeps the traffic', () => {
    const lines = websitePurgeImpact('heatmaps', IMPACT, t, 'en-GB')
    expect(lines.map((line) => line.count)).toEqual(['560', '3', undefined])
    expect(lines.at(-1)?.label).toBe(
      'page.marketing.websites.purge.kept_traffic',
    )
  })

  it('counts the traffic too for all the data, since the oldest day', () => {
    const lines = websitePurgeImpact(
      'all',
      { ...IMPACT, since: Date.UTC(2026, 0, 5) },
      t,
      'en-GB',
    )
    expect(lines.map((line) => line.count)).toEqual([
      '1,200',
      '3,400',
      '560',
      '3',
      undefined,
    ])
    expect(lines[0]?.label).toContain(
      'page.marketing.websites.delete.sessions_since',
    )
    expect(lines.at(-1)?.label).toBe('page.marketing.websites.purge.kept')
  })

  it('says what a purge deleted, in its scope', () => {
    const deleted = {
      events: 9,
      sessions: 2,
      days: 1,
      snapshots: 0,
      imports: 0,
    }
    expect(
      websitePurgeResult(
        { purged: 'site', scope: 'heatmaps', deleted },
        t,
        'en-GB',
      ),
    ).toBe(
      'page.marketing.websites.purge.done_heatmaps_counts {"events":"9","snapshots":"0"}',
    )
    expect(
      websitePurgeResult({ purged: 'site', scope: 'all', deleted }, t, 'en-GB'),
    ).toContain('"sessions":"2"')
  })
})
