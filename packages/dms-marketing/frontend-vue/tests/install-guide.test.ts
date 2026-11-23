import { createSSRApp, h, ref, type FunctionalComponent } from 'vue'
import { bareStub } from './bare-stub'
import { renderToString } from 'vue/server-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InstallGuide from '../app/components/InstallGuide.vue'
import { websitesLink } from '../app/composables/useMarketingRoutes'
import { setDmsRouteQuery } from './stubs/frontend-module'

const WEBSITE = {
  id: 'acme-shop',
  name: 'Acme Shop',
  domain: 'shop.example.com',
}

/** A component drawn as its slot, every attribute kept. */
const slot = (name: string) =>
  bareStub((_props, { slots, attrs }) =>
    h('div', { 'data-stub': name, ...attrs }, slots.default?.()),
  )

/** A link drawn as an anchor on its target. */
const link = (name: string) => {
  const anchor: FunctionalComponent<{ to?: string }> = (props, { slots }) =>
    h('a', { 'data-stub': name, href: props.to }, slots.default?.())
  anchor.props = ['to']
  return anchor
}

beforeEach(() => {
  setDmsRouteQuery({ website: WEBSITE.id })
  vi.stubGlobal('useApiData', () => ({
    data: ref({ website: WEBSITE, visit: null, checkedAt: 0 }),
    error: ref(null),
    status: ref('success'),
    clear: () => {},
  }))
  vi.stubGlobal('useAuthFetch', () => ({ $authFetch: async () => ({}) }))
  vi.stubGlobal('useToast', () => ({ add: () => {} }))
  vi.stubGlobal('useApiErrorPresenter', () => ({ presentError: vi.fn() }))
  vi.stubGlobal('useConfirm', () => ({ confirm: async () => false }))
  vi.stubGlobal('useFieldErrors', () => ({
    aria: () => ({}),
    clear: () => {},
    setError: async () => {},
    handleApiError: async () => {},
    toastError: () => {},
  }))
  vi.stubGlobal('apiErrorStatus', () => undefined)
  vi.stubGlobal('refreshPageBlocks', async () => {})
  vi.stubGlobal('formatDateTime', () => '')
})

afterEach(() => {
  setDmsRouteQuery({})
  vi.unstubAllGlobals()
})

async function render(): Promise<string> {
  const app = createSSRApp(() => h(InstallGuide))
  app.component('DmsAutoLink', link('DmsAutoLink'))
  for (const name of [
    'DmsNoticeBanner',
    'DmsEmptyState',
    'DmsEyebrowLabel',
    'DmsFieldError',
    'DmsFieldRow',
    'DmsFormRequiredLegend',
    'DmsIconWell',
    'DmsMarketingTrackerSnippet',
    'DmsStatusPill',
    'UButton',
    'UCollapsible',
    'UIcon',
    'UInput',
    'USkeleton',
  ]) {
    app.component(name, slot(name))
  }
  return renderToString(app)
}

describe('InstallGuide', () => {
  it("opens the added site's settings modal from step 1's Edit", async () => {
    const html = await render()
    const edit = [
      ...html.matchAll(
        /<a data-stub="DmsAutoLink" href="([^"]*)"[^>]*>([^<]*)</g,
      ),
    ].find(([, , label]) => label?.trim() === 'page.marketing.common.edit')
    expect(edit?.[1]?.replaceAll('&amp;', '&')).toBe(websitesLink(WEBSITE.id))
  })
})
