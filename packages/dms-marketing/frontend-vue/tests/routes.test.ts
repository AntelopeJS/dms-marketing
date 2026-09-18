import { describe, expect, it } from 'vitest'
import {
  campaignsLink,
  funnelsLink,
  pagesLink,
} from '../app/composables/useMarketingRoutes'

describe('module links', () => {
  it('stay bare when nothing is selected', () => {
    expect(pagesLink()).toEqual({ path: '/modules/marketing/pages', query: {} })
    expect(campaignsLink()).toEqual({
      path: '/modules/marketing/campaigns',
      query: {},
    })
    expect(funnelsLink()).toEqual({
      path: '/modules/marketing/funnels',
      query: {},
    })
  })

  it('carry only the selections that have a value', () => {
    expect(pagesLink({ website: 'w1', path: undefined, period: '7d' })).toEqual({
      path: '/modules/marketing/pages',
      query: { website: 'w1', period: '7d' },
    })
    expect(funnelsLink({ website: 'w1', funnel: null })).toEqual({
      path: '/modules/marketing/funnels',
      query: { website: 'w1' },
    })
  })
})
