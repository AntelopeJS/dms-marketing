import { computed, createSSRApp, defineComponent, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PagesExplorer from '../app/components/PagesExplorer.vue'
import WorkspaceScope from '../app/components/WorkspaceScope.vue'
import { MARKETING_CONTEXT_KEY } from '../app/composables/useMarketingContext'
import { ALL_WORKSPACES } from '../app/utils/workspace-scope'

const OWN = { id: 'tenant-a', name: 'Alpha', current: true }
const OTHER = { id: 'tenant-b', name: 'Beta', current: false }

/** The Nuxt UI parts, drawn as their slot; the tooltip keeps its text. */
const UI_STUBS = {
  UDropdownMenu: defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h('div', slots.default?.()),
  }),
  UButton: defineComponent({
    inheritAttrs: false,
    setup:
      (_props, { slots, attrs }) =>
      () =>
        h(
          'button',
          {
            'aria-label': attrs['aria-label'],
            'aria-describedby': attrs['aria-describedby'],
          },
          slots.default?.(),
        ),
  }),
  UTooltip: defineComponent({
    props: { text: String },
    setup:
      (props, { slots }) =>
      () =>
        h('div', { 'data-tooltip': props.text }, slots.default?.()),
  }),
  UIcon: defineComponent({ setup: () => () => h('i') }),
}

/** What each read of the explorer answers, by the path it reads. */
const READS: Record<string, unknown> = {
  '/api/marketing/stats/workspaces': { workspaces: [OWN, OTHER] },
  '/api/marketing/websites': [{ _id: 'acme-shop', name: 'Acme Shop' }],
  '/api/marketing/stats/pages': {
    pages: [{ path: '/', pageviews: 3, clicks: 1, snapshot: null }],
    total: 1,
    sampleRate: 1,
    trackerEnabled: true,
  },
  '/api/marketing/tables/funnels/list': [],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The explorer on a live website, drawn by the server. */
async function renderExplorer(): Promise<string> {
  vi.stubGlobal('useApiData', (url: unknown) => {
    const path = typeof url === 'function' ? url() : url
    const read = {
      data: ref(READS[String(path).split('?')[0]!] ?? null),
      error: ref(null),
      status: ref('success'),
      refresh: async () => {},
    }
    return {
      ...read,
      then: (resolve: (value: typeof read) => void) => resolve(read),
    }
  })
  vi.stubGlobal('usePeriodScope', () =>
    ref({ range: { from: new Date(0), to: new Date(86_400_000) } }),
  )
  vi.stubGlobal('appendPeriodToUrl', (url: string) => url)
  vi.stubGlobal('isDmsHydrating', () => false)
  vi.stubGlobal('useDmsState', (_key: string, init: () => unknown) =>
    ref(init()),
  )
  vi.stubGlobal('formatPercentage', () => '100 %')
  const website = {
    id: 'acme-shop',
    name: 'Acme Shop',
    domain: 'shop.example.com',
    state: 'live',
    lastActivityAt: null,
  }
  const app = createSSRApp(
    defineComponent({ setup: () => () => h(PagesExplorer) }),
  )
  app.provide(MARKETING_CONTEXT_KEY, {
    websites: computed(() => [website]),
    selected: computed(() => website),
    select: async () => {},
    reload: async () => {},
  })
  for (const name of [
    'DmsBanner',
    'DmsEmptyState',
    'DmsEyebrow',
    'DmsMarketingWorkspaceScope',
    'DmsSegmented',
    'UButton',
    'UIcon',
    'UInput',
    'USkeleton',
  ]) {
    app.component(
      name,
      defineComponent({
        name,
        inheritAttrs: false,
        setup:
          (_props, { slots }) =>
          () =>
            h('div', { 'data-stub': name }, slots.default?.()),
      }),
    )
  }
  return renderToString(app)
}

async function renderScope(modelValue: string): Promise<string> {
  const app = createSSRApp(
    defineComponent({
      setup: () => () =>
        h(WorkspaceScope, { workspaces: [OWN, OTHER], modelValue }),
    }),
  )
  for (const [name, component] of Object.entries(UI_STUBS)) {
    app.component(name, component)
  }
  return renderToString(app)
}

describe('the workspace selector', () => {
  it('says nothing more on the own workspace', async () => {
    const html = await renderScope('')
    expect(html).toContain('page.marketing.pages.workspace.switch')
    expect(html).not.toContain('page.marketing.pages.workspace.note_label')
    expect(html).not.toContain('aria-describedby')
  })

  it('puts the read-only note in a focusable tooltip, never as a line', async () => {
    for (const [value, note] of [
      [ALL_WORKSPACES, 'page.marketing.pages.workspace.combined_note'],
      [OTHER.id, 'page.marketing.pages.workspace.other_note'],
    ]) {
      const html = await renderScope(value!)
      expect(html).not.toMatch(/<p\b/)
      expect(html).toContain(`data-tooltip="${note}"`)
      const icon = html.match(
        /<span[^>]*tabindex="0"[^>]*aria-label="page\.marketing\.pages\.workspace\.note_label"[^>]*>/,
      )?.[0]
      expect(icon).toBeDefined()
      const noteId = icon?.match(/aria-describedby="([^"]+)"/)?.[1]
      expect(noteId).toBeTruthy()
      // The selector and the icon both point at the note's text.
      expect(html).toContain(`id="${noteId}" class="sr-only">${note}<`)
      expect(html).toContain(
        `<button aria-label="page.marketing.pages.workspace.switch" aria-describedby="${noteId}"`,
      )
    }
  })

  it('sits in the pages panel, above its search', async () => {
    const html = await renderExplorer()
    const panel = html.search(/<section class="[^"]*\bdms-card\b/)
    const scope = html.indexOf('data-stub="DmsMarketingWorkspaceScope"')
    const search = html.indexOf('data-stub="UInput"')
    expect(panel).toBeGreaterThan(-1)
    expect(scope).toBeGreaterThan(panel)
    expect(search).toBeGreaterThan(scope)
    expect(html.indexOf('</section>', panel)).toBeGreaterThan(search)
    // Only once: no copy of it left above the panes.
    expect(html.lastIndexOf('data-stub="DmsMarketingWorkspaceScope"')).toBe(
      scope,
    )
  })
})
