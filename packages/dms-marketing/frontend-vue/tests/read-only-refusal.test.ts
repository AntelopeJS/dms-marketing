import { computed, createSSRApp, defineComponent, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { createFetch } from 'ofetch'
import { useReadOnlyRefusal } from '../node_modules/@antelopejs/dms/frontend-vue/layers/dms-core/app/composables/useReadOnlyRefusal'
import { useAuthFetch } from '../node_modules/@antelopejs/dms/frontend-vue/layers/dms-core/app/composables/auth/useAuthFetch'
import FunnelReport from '../app/components/FunnelReport.vue'
import { useLatestRequest } from '../app/composables/useLatestRequest'
import { useContextWebsite } from '../app/composables/useContextWebsite'
import { useMarketingApi } from '../app/composables/useMarketingApi'
import { useCopyDraft } from '../app/composables/useCopyDraft'
import { useDraftLoad } from '../app/build/composables/useDraftLoad'
import { usePreviewSnapshot } from '../app/build/composables/usePreviewSnapshot'
import { setDmsRouteQuery, useDmsRoute } from './stubs/frontend-module'

const READ_ONLY = 'Read-only demo, changes are not saved'

function refusal(marked: boolean) {
  return {
    response: new Response(null, {
      status: 403,
      headers: marked ? { 'x-dms-readonly': '1' } : {},
    }),
  }
}

function notices() {
  const add = vi.fn()
  const presented = ref(new WeakSet<object>())
  vi.stubGlobal('useToast', () => ({ add }))
  vi.stubGlobal('getAppTranslation', () => ({
    processApiMessage: () => READ_ONLY,
  }))
  vi.stubGlobal('useDmsState', (key: string, init: () => unknown) =>
    key === 'dms.readOnly.presentedResponses' ? presented : ref(init()),
  )
  vi.stubGlobal('useReadOnlyRefusal', useReadOnlyRefusal)
  return add
}

afterEach(() => vi.unstubAllGlobals())

it.each([true, false])(
  'stopping a test presents a marked=%s refusal once',
  async (marked) => {
    const add = notices()
    const error = refusal(marked)
    const consume = useReadOnlyRefusal()
    vi.stubGlobal('useAuthFetch', () => ({
      $authFetch: async () => {
        consume(error)
        throw error
      },
    }))
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
    expect(add.mock.calls.map(([notice]) => notice.title)).toEqual([
      marked ? READ_ONLY : 'page.marketing.funnel.lifecycle.error',
    ])
  },
)

it.each([true, false])(
  'request failures keep cleanup but hide marked=%s inline notices',
  async (marked) => {
    const add = notices()
    const error = refusal(marked)
    const consume = useReadOnlyRefusal()
    const request = useLatestRequest(async () => {
      consume(error)
      throw error
    })
    await request.run()
    expect(request.failed.value).toBe(!marked)
    expect(request.loading.value).toBe(false)
    expect(request.settled.value).toBe(true)
    expect(request.data.value).toBeNull()
    expect(add.mock.calls.map(([notice]) => notice.title)).toEqual(
      marked ? [READ_ONLY] : [],
    )
  },
)

it.each([true, false])(
  'website selection keeps rollback for marked=%s',
  async (marked) => {
    const add = notices()
    const error = refusal(marked)
    const consume = useReadOnlyRefusal()
    const refresh = vi.fn(async () => {})
    vi.stubGlobal('useApiData', () => ({
      data: ref({ websites: [], selectedId: 'old' }),
      error: ref(null),
      status: ref('success'),
      refresh,
    }))
    vi.stubGlobal('useAuthFetch', () => ({
      $authFetch: async () => {
        consume(error)
        throw error
      },
    }))
    setDmsRouteQuery({})
    const selection = useContextWebsite()
    await selection.select('new')
    expect(selection.selectedId.value).toBe('old')
    expect(selection.switching.value).toBe(false)
    expect(refresh).toHaveBeenCalledOnce()
    expect(add.mock.calls.map(([notice]) => notice.title)).toEqual([
      marked ? READ_ONLY : 'page.marketing.context.switch_error',
    ])
  },
)

it.each([true, false])(
  'snapshot options keep the website unchanged for marked=%s',
  async (marked) => {
    const add = notices()
    const error = refusal(marked)
    const consume = useReadOnlyRefusal()
    vi.stubGlobal('useAuthFetch', () => ({
      $authFetch: async () => {
        consume(error)
        throw error
      },
    }))
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
      { add },
    )
    await preview.updateSnapshotOptions({ snapshotsEnabled: true })
    expect(preview.savingOptions.value).toBe(false)
    expect(website.snapshotsEnabled).toBe(false)
    expect(emit).not.toHaveBeenCalled()
    expect(add.mock.calls.map(([notice]) => notice.title)).toEqual([
      marked ? READ_ONLY : 'page.marketing.pages.preview.options_error',
    ])
  },
)

it.each([true, false])(
  'draft loading clears pending without a marked=%s inline error',
  async (marked) => {
    const add = notices()
    const error = refusal(marked)
    const consume = useReadOnlyRefusal()
    vi.stubGlobal('useApiData', () => ({
      data: ref(null),
      error: ref(error),
      execute: async () => {
        consume(error)
      },
    }))
    vi.stubGlobal('apiErrorStatus', () => 403)
    const loading = ref(false)
    const failed = ref<'not_found' | 'error' | null>(null)
    const values = () => ({
      name: '',
      websiteId: '',
      steps: [],
      windowHours: 24,
      split: false,
      experimentKey: '',
      variations: [],
    })
    const copy = useCopyDraft({ values, dirty: ref(false), markClean: vi.fn() })
    let load = async () => {}
    const app = createSSRApp(
      defineComponent({
        setup() {
          load = useDraftLoad(
            'quote',
            '',
            values,
            vi.fn(),
            useDmsRoute(),
            ref(null),
            ref(''),
            (key) => key,
            copy,
            () => '',
            ref(''),
            loading,
            failed,
            true,
            ref([]),
            () => 1,
            vi.fn(),
            404,
          ).load
          return () => h('div')
        },
      }),
    )
    await renderToString(app)
    await load()
    expect(loading.value).toBe(false)
    expect(failed.value).toBe(marked ? null : 'error')
    expect(add.mock.calls.map(([notice]) => notice.title)).toEqual(
      marked ? [READ_ONLY] : [],
    )
  },
)

it.each([true, false])(
  'background dashboard tracking stays silent for marked=%s',
  async (marked) => {
    const add = notices()
    const { response } = refusal(marked)
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
  },
)
