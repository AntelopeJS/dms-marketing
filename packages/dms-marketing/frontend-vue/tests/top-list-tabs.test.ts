import { createSSRApp, defineComponent, h, onServerPrefetch, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The overview top lists as a server renders them: with their data, the
 * rows of the first tab (a watcher never runs there once data lands, so
 * the active tab cannot come from one); without, a skeleton the size of a
 * full card.
 */

interface ChartState {
  data: unknown
  isLoading: boolean
  error: unknown
}

let chart: ChartState = { data: null, isLoading: false, error: null }

const globals = globalThis as Record<string, unknown>

beforeAll(() => {
  // As `useAsyncData` on a server: the answer lands in `serverPrefetch`,
  // after setup, before the render.
  globals.useChartFetch = () => {
    const data = ref<unknown>(null)
    const isLoading = ref(true)
    const error = ref<unknown>(null)
    onServerPrefetch(async () => {
      data.value = chart.data
      isLoading.value = chart.isLoading
      error.value = chart.error
    })
    return { data, isLoading, error, refresh: async () => {} }
  }
  globals.useTranslation = () => ({ processI18n: (key: string) => key })
})

/** An auto-import the template reads: an app global, as Nuxt provides it. */
const formatPercentage = (value: number) => `${Math.round(value * 100)}%`

const slotStub = (tag: string) =>
  defineComponent({
    inheritAttrs: false,
    setup:
      (_, { slots, attrs }) =>
      () =>
        h(tag, { class: attrs.class }, [
          String(attrs.title ?? attrs.label ?? ''),
          slots.default?.(),
        ]),
  })

const STUBS = {
  DmsEyebrow: slotStub('p'),
  DmsEmptyState: slotStub('div'),
  DmsStatusPill: slotStub('span'),
  DmsAutoLink: slotStub('a'),
  UTabs: slotStub('div'),
  UButton: slotStub('button'),
  UIcon: slotStub('i'),
  USkeleton: defineComponent({
    inheritAttrs: false,
    setup:
      (_, { attrs }) =>
      () =>
        h('div', { class: ['skeleton', attrs.class] }),
  }),
}

async function render(state: ChartState): Promise<string> {
  chart = state
  const { default: TopListTabs } =
    await import('../app/components/TopListTabs.vue')
  const app = createSSRApp(TopListTabs, {
    fetchUrl: '/api/marketing/blocks/tops?group=content',
    eyebrow: 'Content',
    valueLabel: 'Views',
  })
  app.config.globalProperties.formatPercentage = formatPercentage
  for (const [name, component] of Object.entries(STUBS)) {
    app.component(name, component)
  }
  return renderToString(app)
}

const TABS = {
  tabs: [
    {
      id: 'pages',
      label: 'Top pages',
      labelKind: 'raw',
      total: 3,
      items: [
        { id: '/home', title: '/home', value: 2, share: 66.7 },
        { id: '/pricing', title: '/pricing', value: 1, share: 33.3 },
      ],
    },
    {
      id: 'entry',
      label: 'Entry pages',
      labelKind: 'raw',
      total: 1,
      items: [{ id: '/blog', title: '/blog', value: 1, share: 100 }],
    },
  ],
}

function count(html: string, text: string): number {
  return html.split(text).length - 1
}

describe('TopListTabs server render', () => {
  it('draws the first tab’s rows with the page, never its empty state', async () => {
    const html = await render({ data: TABS, isLoading: false, error: null })
    expect(html).toContain('/home')
    expect(html).toContain('/pricing')
    expect(html).not.toContain('/blog')
    expect(html).not.toContain('page.marketing.overview.groups.empty')
    expect(html).not.toContain('skeleton')
  })

  it('keeps the rows on screen while a newer read loads', async () => {
    const html = await render({ data: TABS, isLoading: true, error: null })
    expect(html).toContain('/home')
    expect(html).not.toContain('skeleton')
  })

  it('draws a full card of row-sized skeletons while nothing is there yet', async () => {
    const html = await render({ data: null, isLoading: true, error: null })
    // Eight rows (the route's limit), each on a list row's grid and padding.
    expect(
      count(
        html,
        'grid grid-cols-[1.5rem_minmax(0,1fr)_auto_3rem] items-center gap-x-3 px-4 py-2',
      ),
    ).toBe(8)
    // The label line keeps a row's text height, its share bar under it.
    expect(count(html, 'flex h-[19.5px] items-center')).toBe(8)
    expect(count(html, 'mt-1 h-0.5')).toBe(8)
    // The tab strip's place, at a tab's height, never wrapping the header.
    expect(count(html, 'class="px-2 py-3"')).toBe(3)
    expect(html).toContain(
      'overflow-hidden sm:order-none sm:mx-0 sm:flex-1 sm:basis-0',
    )
  })

  it('shows a failed read as an error, not as a skeleton or an empty list', async () => {
    const html = await render({
      data: null,
      isLoading: false,
      error: new Error('down'),
    })
    expect(html).toContain('page.marketing.common.load_error')
    expect(html).not.toContain('skeleton')
    expect(html).not.toContain('page.marketing.overview.groups.empty')
  })
})
