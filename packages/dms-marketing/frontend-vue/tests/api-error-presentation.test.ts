import { computed, createSSRApp, defineComponent, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { createFetch } from 'ofetch'
import { useApiErrorPresenter } from '../../node_modules/@antelopejs/dms/frontend-vue/layers/dms-core/app/composables/useApiErrorPresenter'
import { useAuthFetch } from '../../node_modules/@antelopejs/dms/frontend-vue/layers/dms-core/app/composables/auth/useAuthFetch'
import FunnelReport from '../app/components/FunnelReport.vue'
import { useContextWebsite } from '../app/composables/useContextWebsite'
import { useMarketingApi } from '../app/composables/useMarketingApi'
import { usePreviewSnapshot } from '../app/build/composables/usePreviewSnapshot'
import { setDmsRouteQuery } from './stubs/frontend-module'

const READ_ONLY = 'Read-only demo, changes are not saved'

function notices(status: number, body: object) {
  const add = vi.fn(() => ({ id: 'notice' }))
  const response = Object.assign(Response.json(body, { status }), {
    _data: body,
  })
  const error = { response }
  const states = new Map<string, ReturnType<typeof ref>>()
  vi.stubEnv('SSR', false)
  vi.stubGlobal('useToast', () => ({ add, remove: vi.fn() }))
  vi.stubGlobal('getPluginI18n', () => ({
    i18n: {
      tm: (key: string) => (key === 'error.read_only_demo' ? READ_ONLY : key),
      rt: (message: string) => message,
    },
  }))
  vi.stubGlobal('useDmsState', (key: string, init: () => unknown) => {
    if (!states.has(key)) {
      states.set(key, ref(init()))
    }
    return states.get(key)
  })
  vi.stubGlobal('useApiErrorPresenter', useApiErrorPresenter)
  vi.stubGlobal('useAuthFetch', () => ({
    $authFetch: async () => {
      throw error
    },
  }))
  return { add, error, response }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it.each([
  [
    403,
    { message: 'error.read_only_demo', severity: 'warning' },
    READ_ONLY,
    'warning',
  ],
  [403, {}, 'page.marketing.funnel.lifecycle.error', 'warning'],
  [503, {}, 'page.marketing.funnel.lifecycle.error', 'error'],
])(
  'stopping a test presents HTTP %s once with the server reason or fallback',
  async (status, body, title, color) => {
    const { add, error } = notices(status, body)
    vi.stubGlobal('useChartFetch', () => ({
      data: ref({
        funnel: {
          _id: 'quote',
          websiteId: 'site',
          name: 'Quote',
          steps: [],
          conversionWindowMs: 3_600_000,
          experiment: {
            key: 'cta',
            status: 'running',
            variations: [],
            runs: [],
          },
        },
        window: { since: 0, until: 1 },
        computation: { events: 0, steps: [] },
      }),
      isLoading: ref(false),
      error: ref(null),
      refresh: vi.fn(),
    }))
    vi.stubGlobal('useConfirm', () => ({
      confirm: async (options: { onConfirm: () => Promise<void> }) =>
        options.onConfirm(),
    }))
    vi.stubGlobal('useConfirmFrom', () => ({ confirmFrom: vi.fn() }))
    vi.stubGlobal('usePageRecordLabel', () => ({ setLabel: vi.fn() }))
    vi.stubGlobal('withPeriodQuery', (url: string) => url)
    vi.stubGlobal('readerTimeZone', () => 'UTC')
    vi.stubGlobal('apiErrorStatus', () => 0)
    setDmsRouteQuery({ id: 'quote' })
    let stop = async () => {
      throw new Error('Stop button not rendered')
    }
    const app = createSSRApp(FunnelReport)
    app.config.warnHandler = () => {}
    app.component(
      'UButton',
      defineComponent({
        props: ['label', 'onClick'],
        setup(props) {
          if (props.label === 'page.marketing.funnel.lifecycle.stop') {
            stop = props.onClick
          }
          return () => h('button', props.label)
        },
      }),
    )
    await renderToString(app)
    await stop()
    useApiErrorPresenter().presentError(error, {
      fallbackKey: 'another.fallback',
    })
    expect(add.mock.calls).toEqual([
      [expect.objectContaining({ title, color })],
    ])
  },
)

it('website selection presents the JSON refusal once and rolls back', async () => {
  const { add } = notices(403, {
    message: 'error.read_only_demo',
    severity: 'warning',
  })
  const refresh = vi.fn(async () => {})
  vi.stubGlobal('useApiData', () => ({
    data: ref({ websites: [], selectedId: 'old' }),
    error: ref(null),
    status: ref('success'),
    refresh,
  }))
  setDmsRouteQuery({})
  const selection = useContextWebsite()
  await selection.select('new')
  expect(selection.selectedId.value).toBe('old')
  expect(selection.switching.value).toBe(false)
  expect(refresh).toHaveBeenCalledOnce()
  expect(add.mock.calls).toEqual([
    [expect.objectContaining({ title: READ_ONLY, color: 'warning' })],
  ])
})

it('snapshot options present the JSON refusal once without changing the website', async () => {
  const { add } = notices(403, {
    message: 'error.read_only_demo',
    severity: 'warning',
  })
  vi.stubGlobal('useApiData', () => ({
    data: ref({ snapshots: 0 }),
    error: ref(null),
    status: ref('success'),
    execute: async () => {},
  }))
  const website = {
    _id: 'site',
    name: 'Shop',
    domain: 'shop.example.com',
    snapshotsEnabled: false,
    trackingEnabled: true,
  }
  const emit = vi.fn()
  const preview = usePreviewSnapshot(
    1280,
    [],
    computed(() => false),
    {
      website,
      path: '/',
      period: null,
      sampleRateLabel: null,
      trackerEnabled: true,
    },
    ref('en'),
    async () => true,
    (key) => key,
    emit,
    useMarketingApi(),
  )
  await preview.updateSnapshotOptions({ snapshotsEnabled: true })
  expect(preview.savingOptions.value).toBe(false)
  expect(website.snapshotsEnabled).toBe(false)
  expect(emit).not.toHaveBeenCalled()
  expect(add.mock.calls).toEqual([
    [expect.objectContaining({ title: READ_ONLY, color: 'warning' })],
  ])
})

it('background dashboard tracking stays silent on a JSON refusal', async () => {
  const { add, response } = notices(403, {
    message: 'error.read_only_demo',
    severity: 'warning',
  })
  vi.stubGlobal('$fetch', createFetch({ fetch: async () => response }))
  vi.stubGlobal('useAuthFetch', useAuthFetch)
  vi.stubGlobal('HTTP_UNAUTHORIZED', 401)
  vi.stubGlobal('useDmsUserSession', () => ({ loggedIn: ref(false) }))
  vi.stubGlobal('useSessionRecovery', () => ({
    refreshSession: vi.fn(),
    reconcileSession: vi.fn(),
    redirectToAuth: vi.fn(),
  }))
  vi.stubGlobal('useDmsRuntimeConfig', () => ({
    public: { dms: { baseURL: 'https://demo.example' } },
  }))
  vi.stubGlobal('useDmsApp', () => ({ $i18n: { locale: ref('en') } }))
  await expect(useMarketingApi().dashboardTracking()).rejects.toMatchObject({
    response,
  })
  expect(add).not.toHaveBeenCalled()
})
