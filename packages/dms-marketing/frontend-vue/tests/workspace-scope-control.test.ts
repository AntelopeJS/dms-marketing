import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import WorkspaceScope from '../app/components/WorkspaceScope.vue'
import { ALL_WORKSPACES } from '../app/utils/workspace-scope'

const EXPLORER = join(process.cwd(), 'app', 'components', 'PagesExplorer.vue')

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

  it('sits in the pages panel, above its search', () => {
    const source = readFileSync(EXPLORER, 'utf8')
    const template = source.slice(source.indexOf('<template>'))
    const panel = template.indexOf('class="dms-card flex min-w-0 flex-col')
    const scope = template.indexOf('<DmsMarketingWorkspaceScope')
    const search = template.indexOf('v-model="search"')
    expect(panel).toBeGreaterThan(-1)
    expect(scope).toBeGreaterThan(panel)
    expect(search).toBeGreaterThan(scope)
    // Only once: no copy of it left above the panes.
    expect(template.lastIndexOf('<DmsMarketingWorkspaceScope')).toBe(scope)
  })
})
