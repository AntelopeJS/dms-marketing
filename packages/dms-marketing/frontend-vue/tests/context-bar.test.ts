import {
  computed,
  createSSRApp,
  defineComponent,
  h,
  ref,
  toValue,
  type Ref,
} from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Context from '../app/components/Context.vue'
import type { MarketingContextPayload } from '../app/composables/useMarketingContext'

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

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  contextData = ref(CONTEXT)
  readOptions = {}
  paused = ref(false)
  vi.stubGlobal(
    'useApiData',
    (_url: unknown, options: Record<string, unknown> = {}) => {
      readOptions = options
      return {
        data: contextData,
        error: ref(null),
        status: ref('success'),
        refresh: async () => {},
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
  vi.stubGlobal('refreshLivePageBlocks', () => {})
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

async function renderBar(): Promise<string> {
  const app = createSSRApp(
    defineComponent({
      setup: () => () => h(Context, null, { default: () => h('main') }),
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

  it('keeps the module presets and comparisons, at the toolbar size', async () => {
    const options = periodOptions(await renderBar())
    expect(options).toMatchObject({
      id: 'marketing',
      'component-id': 'marketing-context-period',
      variant: 'segmented',
      'default-preset': 'last-30-days',
      'default-comparison': 'previous-period',
      'comparison-control': 'menu',
      'range-label': 'relative',
    })
    expect(options).not.toHaveProperty('size')
    expect(options).not.toHaveProperty('align')
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

  it("stops reading the websites' last events while the page is paused", async () => {
    await renderBar()
    const interval = () => toValue(readOptions.refreshInterval as () => number)
    expect(readOptions.refreshOnPageRefresh).toBe(false)
    expect(interval()).toBe(60_000)
    paused.value = true
    expect(interval()).toBeNull()
  })
})
