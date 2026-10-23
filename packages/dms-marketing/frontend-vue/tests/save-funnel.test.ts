import { describe, expect, it, vi } from 'vitest'
import {
  saveFunnel,
  type MarketingFunnelInput,
  type MarketingFunnelListItem,
} from '../app/composables/useMarketingApi'

const INPUT: MarketingFunnelInput = {
  websiteId: 'acme-shop',
  name: 'Checkout',
  steps: [{ kind: 'url', value: '/cart' }],
  conversionWindowHours: 24,
  experiment: null,
}

// What interface-data-api 0.3 answers on `new`: the created row, not its key
// in an array.
const CREATED: MarketingFunnelListItem = {
  _id: 'funnel-new',
  websiteId: 'acme-shop',
  name: 'Checkout',
  steps: [{ kind: 'url', value: '/cart' }],
  conversionWindowHours: 24,
  experiment: null,
}

function fakeApi() {
  return {
    createFunnel: vi.fn(async () => CREATED),
    updateFunnel: vi.fn(async () => CREATED),
  }
}

describe('saving a funnel', () => {
  it('answers the id of the row the insert created', async () => {
    const api = fakeApi()
    expect(await saveFunnel(api, INPUT)).toBe('funnel-new')
    expect(api.updateFunnel).not.toHaveBeenCalled()
  })

  it('updates the definition it edits and answers its id', async () => {
    const api = fakeApi()
    expect(await saveFunnel(api, INPUT, 'funnel-1')).toBe('funnel-1')
    expect(api.updateFunnel).toHaveBeenCalledWith('funnel-1', INPUT)
    expect(api.createFunnel).not.toHaveBeenCalled()
  })
})
