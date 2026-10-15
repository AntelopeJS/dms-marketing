import { createSSRApp, defineComponent, h, ref, toValue } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useFunnelTemplates,
  usePageInventory,
  useWebsiteConnection,
  useWebsiteFunnels,
} from '../app/composables/useMarketingReads'
import { useMarketingNow } from '../app/composables/useMarketingNow'

/** What a read asked `useApiData` for. */
interface ReadCall {
  url: () => string | null
  options: Record<string, unknown>
}

let calls: ReadCall[]

const PERIOD = {
  preset: 'last-7-days',
  comparison: 'none',
  range: {
    from: new Date('2026-10-09T00:00:00.000Z'),
    to: new Date('2026-10-15T23:59:59.999Z'),
  },
  compareRange: null,
  key: 'last-7-days',
}

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'useApiData',
    (url: unknown, options: Record<string, unknown> = {}) => {
      calls.push({ url: () => toValue(url as () => string | null), options })
      return { data: ref(null) }
    },
  )
  // The DMS's own, as the module's blocks append a period.
  vi.stubGlobal(
    'appendPeriodToUrl',
    (url: string, state: typeof PERIOD | null) =>
      state?.range
        ? `${url}?from=${state.range.from.toISOString()}&to=${state.range.to.toISOString()}`
        : url,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const query = (call: ReadCall | undefined) =>
  toValue(call?.options.query as () => Record<string, unknown>)

describe('the reads the pages render', () => {
  it('reads nothing bound to the period before there is one, nor without a website', () => {
    const website = ref('')
    const period = ref<typeof PERIOD | null>(null)
    usePageInventory({
      websiteId: website,
      period,
      search: '',
      sort: 'views',
      refreshToken: 0,
    })
    useFunnelTemplates(website, period)
    const [pages, templates] = calls
    expect(pages?.url()).toBeNull()
    expect(templates?.url()).toBeNull()
    website.value = 'acme-shop'
    expect(pages?.url()).toBeNull()
    period.value = PERIOD
    expect(pages?.url()).toBe(
      '/api/marketing/stats/pages?from=2026-10-09T00:00:00.000Z&to=2026-10-15T23:59:59.999Z',
    )
    expect(query(pages)).toEqual({
      website: 'acme-shop',
      search: '',
      sort: 'views',
    })
    expect(templates?.url()).toContain('/api/marketing/funnels/templates?from=')
    expect(query(templates)).toEqual({ website: 'acme-shop' })
  })

  it('lists a website funnels oldest first, read again with the page refresh', () => {
    const token = ref(0)
    useWebsiteFunnels('acme-shop', token)
    const [funnels] = calls
    expect(funnels?.url()).toBe('/api/marketing/tables/funnels/list')
    expect(query(funnels)).toMatchObject({
      filter_websiteId: 'is:acme-shop',
      sortKey: 'createdAt',
      sortDirection: 'asc',
    })
    const [source] = funnels?.options.watch as (() => number)[]
    token.value = 3
    expect(source?.()).toBe(3)
    const transform = funnels?.options.transform as (value: unknown) => unknown
    expect(transform({ results: [{ _id: 'f1' }], total: 1 })).toEqual([
      { _id: 'f1' },
    ])
  })

  it('checks a website connection since a server time, once there is a website', () => {
    const website = ref('')
    const since = ref<number | null>(null)
    useWebsiteConnection(website, since)
    const [connection] = calls
    expect(connection?.url()).toBeNull()
    website.value = 'shop/eu'
    expect(connection?.url()).toBe(
      '/api/marketing/websites/shop%2Feu/connection',
    )
    expect(query(connection)).toEqual({ since: undefined })
    since.value = 1_700_000_000_000
    expect(query(connection)).toEqual({ since: 1_700_000_000_000 })
  })
})

describe('useMarketingNow', () => {
  it('starts from the time the server rendered at, handed to the browser', async () => {
    const state = new Map<string, { value: unknown }>()
    const transferred: string[] = []
    vi.stubGlobal(
      'useDmsState',
      (key: string, init: () => unknown, options?: { transfer?: boolean }) => {
        if (options?.transfer) {
          transferred.push(key)
        }
        if (!state.has(key)) {
          state.set(key, ref(init()))
        }
        return state.get(key)
      },
    )
    state.set('marketing-rendered-at', ref(1_000))
    const app = createSSRApp(
      defineComponent({
        setup: () => {
          const now = useMarketingNow(15_000)
          return () => h('span', String(now.value))
        },
      }),
    )
    expect(await renderToString(app)).toBe('<span>1000</span>')
    expect(transferred).toEqual(['marketing-rendered-at'])
  })
})
