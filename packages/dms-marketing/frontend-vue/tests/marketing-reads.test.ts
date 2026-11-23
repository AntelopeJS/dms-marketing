import {
  createSSRApp,
  defineComponent,
  h,
  ref,
  toValue,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue'
import { present } from './present'
import { renderToString } from 'vue/server-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useDashboardWorkspaces,
  useFunnelTemplates,
  useHeatmapCountRead,
  useMarketingContextRead,
  usePageHeatmap,
  usePageInventory,
  usePageSnapshot,
  useWebsiteConnection,
  useWebsiteFunnels,
} from '../app/composables/useMarketingReads'
import { useMarketingNow } from '../app/composables/useMarketingNow'

type ReadQuery = Record<string, string | number | boolean | undefined>

interface FunnelRow {
  _id: string
  websiteId: string
  name: string
  steps: string
  conversionWindowHours: number
}

const FUNNEL: FunnelRow = {
  _id: 'f1',
  websiteId: 'acme-shop',
  name: 'Signup',
  steps: '[]',
  conversionWindowHours: 24,
}

/** The options a read hands `useApiData`, as far as these tests look at them. */
interface ReadOptions {
  query?: MaybeRefOrGetter<ReadQuery>
  transform?: (page: { results: FunnelRow[] | string }) => FunnelRow[]
  watch?: (() => boolean)[]
  refreshInterval?: MaybeRefOrGetter<number | null | undefined>
  refreshOnPageRefresh?: boolean
  server?: boolean
  immediate?: boolean
}

/** What a read asked `useApiData` for. */
interface ReadCall {
  url: () => string | null
  options: ReadOptions
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
    (url: MaybeRefOrGetter<string | null>, options: ReadOptions = {}) => {
      calls.push({ url: () => toValue(url), options })
      return { data: ref(null) }
    },
  )
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

const query = (call: ReadCall | undefined) => toValue(call?.options.query)

describe('the reads the pages render', () => {
  it('reads nothing bound to the period before there is one, nor without a website', () => {
    const website = ref('')
    const period = ref<typeof PERIOD | null>(null)
    void usePageInventory({
      websiteId: website,
      period,
      search: '',
      sort: 'views',
    })
    void useFunnelTemplates(website, period)
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
    void useWebsiteFunnels('acme-shop')
    const [funnels] = calls
    expect(funnels?.url()).toBe('/api/marketing/tables/funnels/list')
    expect(query(funnels)).toMatchObject({
      filter_websiteId: 'is:acme-shop',
      sortKey: 'createdAt',
      sortDirection: 'asc',
    })
    expect(funnels?.options.watch).toBeUndefined()
    expect(funnels?.options.refreshOnPageRefresh).toBeUndefined()
    const transform = present(funnels?.options.transform)
    expect(transform({ results: [FUNNEL] })).toEqual([FUNNEL])
    expect(transform({ results: 'not a list' })).toEqual([])
  })

  it('checks a website connection since a server time, once there is a website', () => {
    const website = ref('')
    const since = ref<number | null>(null)
    void useWebsiteConnection(website, since)
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
    const state = new Map<string, Ref<number>>()
    const transferred: string[] = []
    vi.stubGlobal(
      'useDmsState',
      (key: string, init: () => number, options?: { transfer?: boolean }) => {
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

describe('the reads with triggers of their own', () => {
  it('reads the context bar on its own triggers, on no clock of its own', () => {
    void useMarketingContextRead()
    const [context] = calls
    expect(context?.options).toMatchObject({ refreshOnPageRefresh: false })
    expect(context?.options).not.toHaveProperty('refreshInterval')
  })

  it('polls the connection check when asked to', () => {
    void useWebsiteConnection('acme-shop', null, { refreshInterval: 4000 })
    const [connection] = calls
    expect(connection?.options.refreshInterval).toBe(4000)
  })

  it('follows a reactive polling period, which stops the check at 0', () => {
    const interval = ref(4000)
    void useWebsiteConnection('acme-shop', null, { refreshInterval: interval })
    expect(calls).toHaveLength(1)
    const [connection] = calls
    const polling = () => toValue(connection?.options.refreshInterval)
    expect(polling()).toBe(4000)
    interval.value = 0
    expect(polling()).toBe(0)
  })
})

describe('the dashboard workspaces', () => {
  it('are read with the page, server render included, once there is a site', () => {
    const website = ref('')
    void useDashboardWorkspaces(website)
    const [workspaces] = calls
    expect(workspaces?.options.server).not.toBe(false)
    expect(workspaces?.url()).toBeNull()
    website.value = 'dashboard-site'
    expect(workspaces?.url()).toBe('/api/marketing/stats/workspaces')
    expect(query(workspaces)).toEqual({ website: 'dashboard-site' })
  })
})

describe('the page preview', () => {
  it('reads the clicks in the browser only, once there is a site and a path', () => {
    const website = ref<string | undefined>(undefined)
    const period = ref<typeof PERIOD | null>(null)
    void usePageHeatmap({ websiteId: website, path: '/pricing', period })
    const [heatmap] = calls
    expect(heatmap?.options.server).toBe(false)
    expect(heatmap?.url()).toBeNull()
    website.value = 'acme-shop'
    expect(heatmap?.url()).toBe('/api/marketing/stats/heatmap')
    period.value = PERIOD
    expect(heatmap?.url()).toBe(
      '/api/marketing/stats/heatmap?from=2026-10-09T00:00:00.000Z&to=2026-10-15T23:59:59.999Z',
    )
    expect(query(heatmap)).toEqual({ website: 'acme-shop', path: '/pricing' })
  })

  it('reads no capture while the site keeps none', () => {
    const enabled = ref(false)
    void usePageSnapshot({
      websiteId: 'acme-shop',
      path: '/pricing',
      layout: 'phone',
      enabled,
      maskText: false,
    })
    const [snapshot] = calls
    expect(snapshot?.url()).toBeNull()
    enabled.value = true
    expect(snapshot?.url()).toBe('/api/marketing/stats/snapshot')
    expect(query(snapshot)).toEqual({
      website: 'acme-shop',
      path: '/pricing',
      layout: 'phone',
    })
  })

  it('reads the capture again once the text mask changes, which discards it', () => {
    const maskText = ref(false)
    void usePageSnapshot({
      websiteId: 'acme-shop',
      path: '/pricing',
      layout: 'desktop',
      enabled: true,
      maskText,
    })
    const [snapshot] = calls
    const sources = snapshot?.options.watch
    expect(sources?.map((source) => source())).toEqual([false])
    maskText.value = true
    expect(sources?.map((source) => source())).toEqual([true])
    expect(query(snapshot)).toEqual({
      website: 'acme-shop',
      path: '/pricing',
      layout: 'desktop',
    })
  })
})

describe('the reads a dialog makes when it asks', () => {
  it('reads nothing before, then answers or rejects with the read', async () => {
    const data = ref<unknown>(null)
    const error = ref<unknown>(null)
    const execute = vi.fn(async () => {
      data.value = { events: 3, snapshots: 1 }
    })
    vi.stubGlobal(
      'useApiData',
      (url: MaybeRefOrGetter<string | null>, options: ReadOptions = {}) => {
        calls.push({ url: () => toValue(url), options })
        return { data, error, execute }
      },
    )
    const countHeatmap = useHeatmapCountRead('acme-shop', '/pricing')
    const [count] = calls
    expect(count?.options).toMatchObject({
      immediate: false,
      refreshOnPageRefresh: false,
    })
    expect(execute).not.toHaveBeenCalled()
    expect(count?.url()).toBe('/api/marketing/stats/heatmap/count')
    expect(query(count)).toEqual({ website: 'acme-shop', path: '/pricing' })
    await expect(countHeatmap()).resolves.toEqual({ events: 3, snapshots: 1 })

    const failure = new Error('gone')
    execute.mockImplementationOnce(async () => {
      error.value = failure
    })
    await expect(countHeatmap()).rejects.toBe(failure)
  })
})
