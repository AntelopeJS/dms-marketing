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
import WebsitePicker from '../app/components/WebsitePicker.vue'
import type { MarketingContextPayload } from '../app/composables/useMarketingContext'

const route = vi.hoisted(() => ({ query: {} as Record<string, string> }))

vi.mock('#dms/frontend-module', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDmsRoute: () => ({ query: route.query, path: '/' }),
  useDmsRouter: () => ({ push: async () => {}, replace: async () => {} }),
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
  vi.stubGlobal('usePageToolbarSize', () => ({ size: computed(() => 'sm') }))
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

const TOPIC = 'marketing.events'

async function render(
  component: object,
  props: Record<string, unknown> = {},
): Promise<string> {
  const app = createSSRApp(
    defineComponent({
      setup: () => () =>
        h(component, props, { default: () => h('main', 'blocks') }),
    }),
  )
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

const renderPicker = (props: Record<string, unknown> = {}) =>
  render(WebsitePicker, { realtimeTopic: TOPIC, ...props })

describe('the website picker of the page toolbar', () => {
  it("shows the website's state as a dot and the age of its last event", async () => {
    const html = await renderPicker()
    expect(html).toContain('Acme Shop')
    // The full line is the tooltip and the accessible name.
    expect(html).toContain('aria-label="page.marketing.context.live"')
    expect(html).toMatch(/>1 min\.? ago</)
  })

  it("says when the reader's days start in the state's name, not in a chip", async () => {
    vi.stubGlobal('readerTimeZone', () => 'Europe/Brussels')
    const html = await renderPicker()
    expect(html).toContain(
      'aria-label="page.marketing.context.live. page.marketing.context.utc_days"',
    )
    expect(html).not.toMatch(/>\s*UTC\s*</)
  })

  it('names no website before there is one', async () => {
    contextData.value = { websites: [], selectedId: null }
    const html = await renderPicker()
    expect(html).toContain('page.marketing.context.no_website')
    expect(html).not.toContain('data-website-picker')
  })

  it("reads the websites' last events through the page's live gate, on no clock", async () => {
    await renderPicker()
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
    expect(topicHandlers.size).toBe(0)
  })
})

describe('the context gate', () => {
  it('draws no toolbar of its own: the page declares it', async () => {
    route.query = { website: 'acme-shop' }
    const html = await render(Context)
    expect(html).toContain('blocks')
    expect(html).not.toContain('Acme Shop')
    expect(liveRefreshes).toHaveLength(0)
  })

  it('holds the blocks until the URL names the website', async () => {
    const html = await render(Context)
    expect(html).not.toContain('blocks')
  })

  it('shows the first-run hero without a website', async () => {
    contextData.value = { websites: [], selectedId: null }
    const html = await render(Context)
    expect(html).not.toContain('blocks')
  })
})
