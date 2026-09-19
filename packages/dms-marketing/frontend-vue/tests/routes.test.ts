import { describe, expect, it } from 'vitest'
import {
  campaignsLink,
  funnelsLink,
  pagesLink,
} from '../app/composables/useMarketingRoutes'

describe('module links', () => {
  it('stay bare when nothing is selected', () => {
    expect(pagesLink()).toBe('/modules/marketing/pages')
    expect(campaignsLink()).toBe('/modules/marketing/campaigns')
    expect(funnelsLink()).toBe('/modules/marketing/funnels')
  })

  it('serializes the exact button route and encodes selected values', () => {
    expect(funnelsLink({ website: 'test-site-1' })).toBe(
      '/modules/marketing/funnels?website=test-site-1',
    )
    expect(pagesLink({ website: 'w 1', path: '/pricing?x=1', period: '7d' })).toBe(
      '/modules/marketing/pages?website=w+1&path=%2Fpricing%3Fx%3D1&period=7d',
    )
  })
})
