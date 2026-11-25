import {
  computed,
  createApp,
  type FunctionalComponent,
  h,
  nextTick,
  ref,
  Suspense,
  toValue,
  type MaybeRefOrGetter,
} from 'vue'
import { present } from './present'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PagesExplorer from '../app/components/PagesExplorer.vue'
import {
  type ContextWebsite,
  MARKETING_CONTEXT_KEY,
} from '../app/composables/useMarketingContext'
import { setDmsRouteQuery } from './stubs/frontend-module'

const OWN = { id: 'tenant-a', name: 'Alpha', current: true }
const OTHER = { id: 'tenant-b', name: 'Beta', current: false }
const WEBSITE = {
  _id: 'acme-shop',
  name: 'Acme Shop',
  domain: 'shop.example.com',
  extraDomains: [],
  trackingEnabled: true,
  snapshotsEnabled: false,
}

/** What each read answers, by path: the list reads the same rows whatever the workspace. */
const READS = new Map<string, object>([
  ['/api/marketing/stats/workspaces', { workspaces: [OWN, OTHER] }],
  ['/api/marketing/websites', [WEBSITE]],
  [
    '/api/marketing/stats/pages',
    {
      pages: [{ path: '/pricing', pageviews: 4321, clicks: 3, snapshot: null }],
      total: 1,
      sampleRate: 1,
      trackerEnabled: true,
      snapshotsEnabled: false,
    },
  ],
  ['/api/marketing/tables/funnels/list', []],
])

function read(url: MaybeRefOrGetter<string | null>) {
  const [path = ''] = String(toValue(url)).split('?')
  const answer = READS.get(path) ?? null
  const data = ref<unknown>(null)
  setTimeout(() => {
    data.value = answer
  }, 0)
  const base = {
    data,
    error: ref(null),
    status: ref('success'),
    pending: ref(false),
    refresh: async () => {},
    clear: () => {},
  }
  return { ...base, then: (done: (value: typeof base) => void) => done(base) }
}

/** The UI parts as their slots; the workspace selector forwards its model updates. */
function part(name: string) {
  const stub: FunctionalComponent<
    Record<string, never>,
    ['update:modelValue']
  > = (_props, { slots, emit }) =>
    h(
      'div',
      {
        'data-part': name,
        onPick: (event: CustomEvent<string>) =>
          emit('update:modelValue', event.detail),
      },
      slots.default?.(),
    )
  stub.inheritAttrs = false
  stub.emits = ['update:modelValue']
  return stub
}

async function settle(): Promise<void> {
  for (let round = 0; round < 10; round++) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  setDmsRouteQuery({})
  document.body.innerHTML = ''
})

async function mountExplorer(): Promise<HTMLElement> {
  const globals = {
    useApiData: read,
    usePeriodScope: () =>
      ref({ range: { from: new Date(0), to: new Date(86_400_000) } }),
    appendPeriodToUrl: (url: string) => url,
    isDmsHydrating: () => false,
    useDmsState: <Value>(_key: string, init: () => Value) => ref(init()),
    formatPercentage: () => '100 %',
    formatDateTime: () => '',
    useAuthFetch: () => ({ $authFetch: async () => ({}) }),
    useToast: () => ({ add: () => {} }),
    useApiErrorPresenter: () => ({ presentError: vi.fn() }),
    useConfirm: () => ({ confirm: async () => false }),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  }
  for (const [name, value] of Object.entries(globals)) {
    vi.stubGlobal(name, value)
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false }),
  })
  setDmsRouteQuery({ path: '/pricing' })
  const website: ContextWebsite = {
    id: 'acme-shop',
    name: 'Acme Shop',
    domain: 'shop.example.com',
    state: 'live',
    lastActivityAt: null,
  }
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(() =>
    h(Suspense, null, { default: () => h(PagesExplorer) }),
  )
  for (const [name, value] of Object.entries(globals)) {
    app.config.globalProperties[name] = value
  }
  app.provide(MARKETING_CONTEXT_KEY, {
    websites: computed(() => [website]),
    selected: computed(() => website),
    select: async () => {},
    reload: async () => {},
  })
  for (const name of [
    'DmsAutoLink',
    'DmsNoticeBanner',
    'DmsEmptyState',
    'DmsEyebrowLabel',
    'DmsIconWell',
    'DmsMarketingHeatmapCanvas',
    'DmsMarketingScrollDepthOverlay',
    'DmsMarketingWorkspaceScope',
    'DmsSegmentedControl',
    'UButton',
    'UDropdownMenu',
    'UIcon',
    'UInput',
    'UPopover',
    'USkeleton',
  ]) {
    app.component(name, part(name))
  }
  app.mount(root)
  await settle()
  return root
}

describe('the pages explorer', () => {
  it("drops the selected page's views read in another workspace", async () => {
    const root = await mountExplorer()
    const header = () => root.querySelector('section header')?.textContent ?? ''
    expect(header()).toContain('4,321')
    expect(header()).toContain('page.marketing.pages.views_unit')
    present(
      root.querySelector('[data-part="DmsMarketingWorkspaceScope"]'),
    ).dispatchEvent(new CustomEvent('pick', { detail: OTHER.id }))
    await settle()
    expect(header()).not.toContain('4,321')
    expect(header()).not.toContain('page.marketing.pages.views_unit')
  })
})
