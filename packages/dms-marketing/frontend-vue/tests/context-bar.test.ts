import {
  computed,
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  ref,
  type Ref,
} from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Context from '../app/components/Context.vue'
import type { MarketingContextPayload } from '../app/composables/useMarketingContext'

const route = vi.hoisted(() => ({ query: {} as Record<string, string> }))
const replaced = vi.hoisted(() => [] as unknown[])

vi.mock('#dms/frontend-module', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDmsRoute: () => ({ query: route.query, path: '/' }),
  useDmsRouter: () => ({
    replace: async (location: unknown) => {
      replaced.push(location)
    },
    push: async () => {},
  }),
}))

const NOW = Date.UTC(2026, 9, 16, 12)

const CONTEXT: MarketingContextPayload = {
  websites: [
    {
      id: 'acme-shop',
      name: 'Acme Shop',
      domain: 'shop.example.com',
      state: 'live',
      lastActivityAt: NOW - 60_000,
    },
  ],
  selectedId: 'acme-shop',
}

let contextData: Ref<MarketingContextPayload | null>
let readOptions: Record<string, unknown>
let paused: Ref<boolean>
let liveRefreshes: Array<{
  refresh: () => void
  options: Record<string, unknown>
}>
let topicHandlers: Map<string, (event: object) => void>
let blockRefreshes: number
let contextReads: number

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  contextData = ref(CONTEXT)
  readOptions = {}
  paused = ref(false)
  liveRefreshes = []
  topicHandlers = new Map()
  blockRefreshes = 0
  contextReads = 0
  route.query = {}
  replaced.length = 0
  vi.stubGlobal(
    'useApiData',
    (_url: unknown, options: Record<string, unknown> = {}) => {
      readOptions = options
      return {
        data: contextData,
        error: ref(null),
        status: ref('success'),
        refresh: async () => {
          contextReads += 1
        },
        then: (resolve: (value: undefined) => void) => resolve(undefined),
      }
    },
  )
  vi.stubGlobal('useAuthFetch', () => ({ $authFetch: async () => ({}) }))
  vi.stubGlobal('useToast', () => ({ add: () => {} }))
  vi.stubGlobal('useDmsState', (_key: string, init: () => unknown) =>
    ref(init()),
  )
  vi.stubGlobal('usePeriodScope', () =>
    ref({
      range: {
        from: new Date(NOW - 30 * 86_400_000),
        to: new Date(NOW + 3_600_000),
      },
    }),
  )
  vi.stubGlobal('usePageLive', () => ({
    isPaused: computed(() => paused.value),
  }))
  vi.stubGlobal('refreshLivePageBlocks', () => {
    blockRefreshes += 1
  })
  vi.stubGlobal(
    'usePageLiveRefresh',
    (refresh: () => void, options: Record<string, unknown> = {}) => {
      liveRefreshes.push({ refresh, options })
      return {
        missed: computed(() => 0),
        trigger: () => {},
        refreshNow: refresh,
      }
    },
  )
  vi.stubGlobal(
    'useRealtimeTopic',
    (topic: string, handler: (event: object) => void) => {
      topicHandlers.set(topic, handler)
    },
  )
  vi.stubGlobal('readerTimeZone', () => 'UTC')
  vi.stubGlobal('withQuery', (path: string) => path)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const slot = (name: string) =>
  defineComponent({
    name,
    inheritAttrs: false,
    setup:
      (_props, { slots }) =>
      () =>
        h('div', slots.default?.()),
  })

/** The DMS blocks the bar embeds, drawn with the options they were given. */
const DMS_STUBS = {
  DmsPageToolbarBlock: defineComponent({
    props: { showUpdatedAt: Boolean, refresh: Boolean },
    setup:
      (props, { slots, attrs }) =>
      () =>
        h(
          'section',
          {
            'data-block': 'page-toolbar',
            'data-updated': String(props.showUpdatedAt),
            'data-refresh': String(props.refresh),
            role: attrs.role,
          },
          slots.default?.(),
        ),
  }),
  DmsLiveToggleBlock: defineComponent({
    props: { variant: String },
    setup: (props) => () =>
      h('div', { 'data-block': 'live', 'data-variant': props.variant }),
  }),
  DmsPeriodSelector: defineComponent({
    inheritAttrs: false,
    setup:
      (_props, { attrs }) =>
      () =>
        h('div', { 'data-block': 'period' }, JSON.stringify(attrs)),
  }),
}

const TOPIC = 'marketing.events'

async function renderBar(props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(
    defineComponent({
      setup: () => () =>
        h(
          Context,
          { realtimeTopic: TOPIC, ...props },
          { default: () => h('main') },
        ),
    }),
  )
  for (const [name, component] of Object.entries(DMS_STUBS)) {
    app.component(name, component)
  }
  for (const name of [
    'UDropdownMenu',
    'UButton',
    'USkeleton',
    'UIcon',
    'UTooltip',
    'DmsEmptyState',
    'DmsMarketingFirstRun',
  ]) {
    app.component(name, slot(name))
  }
  return renderToString(app)
}

function periodOptions(html: string): Record<string, unknown> {
  const match = /<div data-block="period">(.*?)<\/div>/.exec(html)
  const text = (match?.[1] ?? '{}').replaceAll('&quot;', '"')
  return JSON.parse(text) as Record<string, unknown>
}

describe('the context bar', () => {
  it('is the page toolbar: the website, then Direct / Pause and the period', async () => {
    const html = await renderBar()
    expect(html).toContain('data-block="page-toolbar"')
    expect(html).toContain('role="toolbar"')
    const website = html.indexOf('Acme Shop')
    const live = html.indexOf('data-block="live"')
    const period = html.indexOf('data-block="period"')
    expect(website).toBeGreaterThan(-1)
    expect(live).toBeGreaterThan(website)
    expect(period).toBeGreaterThan(live)
    expect(html).toContain('data-variant="pill"')
    // The toolbar's own refresh, not one of the bar's.
    expect(html).not.toContain('i-ph-arrow-clockwise')
  })

  it("keeps the module presets and comparisons, drawn as the toolbar's", async () => {
    const options = periodOptions(await renderBar())
    expect(options).toMatchObject({
      id: 'marketing',
      'component-id': 'marketing-context-period',
      variant: 'segmented',
      'default-preset': 'last-30-days',
      'default-comparison': 'previous-period',
      // Its own dropdown: vs previous period, vs previous year, or none.
      'comparison-control': 'menu',
      'range-label': 'relative',
      presets: [
        'today',
        'last-7-days',
        'last-30-days',
        'last-90-days',
        'custom',
      ],
      comparisons: ['previous-period', 'previous-year', 'none'],
    })
    // The DMS short codes (1D / 7D…) and its calendar segment for custom.
    expect(options).not.toHaveProperty('preset-labels')
    expect(options).not.toHaveProperty('size')
    expect(options).not.toHaveProperty('align')
  })

  it("shows the website's state as a dot and the age of its last event", async () => {
    const html = await renderBar()
    // The full line is the tooltip and the accessible name.
    expect(html).toContain('aria-label="page.marketing.context.live"')
    expect(html).toMatch(/>1 min\.? ago</)
  })

  it("says when the reader's days start in the state's name, not in a chip", async () => {
    vi.stubGlobal('readerTimeZone', () => 'Europe/Brussels')
    const html = await renderBar()
    expect(html).toContain(
      'aria-label="page.marketing.context.live. page.marketing.context.utc_days"',
    )
    expect(html).not.toMatch(/>\s*UTC\s*</)
  })

  it('leaves the website to a block of the page with websitePicker off', async () => {
    const html = await renderBar({ websitePicker: false })
    expect(html).not.toContain('page.marketing.context.switch_website')
    expect(html).not.toContain('aria-label="page.marketing.context.live"')
    expect(html).not.toMatch(/>1 min\.? ago</)
    // The rest of the bar stays: Direct / Pause, the period, the refresh.
    expect(html).toContain('data-block="live"')
    expect(html).toContain('data-block="period"')
    expect(html).toContain('data-refresh="true"')
  })

  it('still keeps the remembered website in the URL with websitePicker off', async () => {
    const html = await renderBar({ websitePicker: false })
    expect(replaced).toEqual([{ query: { website: 'acme-shop' } }])
    // The URL names none yet: the page waits for it.
    expect(html).not.toContain('<main')
  })

  it('renders the page on the website the URL names with websitePicker off', async () => {
    route.query = { website: 'acme-shop' }
    const html = await renderBar({ websitePicker: false })
    expect(replaced).toEqual([])
    expect(html).toContain('<main')
  })

  it('names no website, and offers no refresh, before there is one', async () => {
    contextData.value = { websites: [], selectedId: null }
    const html = await renderBar()
    expect(html).toContain('page.marketing.context.no_website')
    expect(html).toContain('data-updated="false"')
    expect(html).toContain('data-refresh="false"')
    expect(html).not.toContain('data-block="live"')
    expect(html).not.toContain('data-block="period"')
  })

  it("reads the websites' last events through the page's live gate, on no clock", async () => {
    await renderBar()
    expect(readOptions.refreshOnPageRefresh).toBe(false)
    expect(readOptions).not.toHaveProperty('refreshInterval')
    const [contextLive] = liveRefreshes
    expect(liveRefreshes).toHaveLength(1)
    expect(contextLive?.options).toEqual({ realtimeTopic: TOPIC })
    contextLive?.refresh()
    expect(contextReads).toBe(1)
    // Nothing of its own ticks the blocks.
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(blockRefreshes).toBe(0)
  })

  it('leaves the blocks with a topic to read on the arrivals by themselves', async () => {
    await renderBar()
    expect(topicHandlers.has(TOPIC)).toBe(false)
  })

  it('asks every block to read on each arrival for blocks without a topic', async () => {
    route.query = { website: 'acme-shop' }
    await renderBar({ refreshBlocksOnEvents: true })
    const onEvent = topicHandlers.get(TOPIC)
    expect(onEvent).toBeDefined()
    onEvent?.({ type: 'collected', payload: { count: 3 } })
    expect(blockRefreshes).toBe(1)
    // A presence snapshot is no arrival.
    onEvent?.({ topic: TOPIC, entries: [] })
    expect(blockRefreshes).toBe(1)
  })
})
