import { expect, it, vi } from 'vitest'
import frontendModule from '../dms.frontend'

/**
 * The backend addresses this module's surfaces by component name — the pages
 * through `CustomComponent('DmsMarketing…')`, the DataTypes through their
 * form components — so a name that stops being registered silently falls back
 * to the generic card renderer instead of failing.
 */
const BACKEND_ADDRESSED = [
  'DmsMarketingOverviewView',
  'DmsMarketingPagesView',
  'DmsMarketingCampaignsView',
  'DmsMarketingFunnelsView',
  'DmsMarketingFunnelStepsInput',
  'DmsMarketingExperimentInput',
]

it('registers every component under the DmsMarketing prefix', async () => {
  const registerComponent = vi.fn()
  const registerPlugin = vi.fn()
  await frontendModule.setup({
    options: { public: {} },
    registerComponent,
    registerPage: vi.fn(),
    registerDynamicPage: vi.fn(),
    registerLayout: vi.fn(),
    registerErrorPage: vi.fn(),
    registerPlugin,
    registerMiddleware: vi.fn(),
    provide: vi.fn(),
    use: vi.fn(),
  })

  const names = registerComponent.mock.calls.map(([name]) => name)
  expect(names.length).toBeGreaterThan(0)
  expect(new Set(names).size).toBe(names.length)
  for (const name of names) {
    expect(name.startsWith('DmsMarketing')).toBe(true)
  }
  for (const name of BACKEND_ADDRESSED) {
    expect(names).toContain(name)
  }
})

it('registers the funnel-steps DataType plugin client-side only', async () => {
  const registerPlugin = vi.fn()
  await frontendModule.setup({
    options: { public: {} },
    registerComponent: vi.fn(),
    registerPage: vi.fn(),
    registerDynamicPage: vi.fn(),
    registerLayout: vi.fn(),
    registerErrorPage: vi.fn(),
    registerPlugin,
    registerMiddleware: vi.fn(),
    provide: vi.fn(),
    use: vi.fn(),
  })

  expect(registerPlugin).toHaveBeenCalledTimes(1)
  expect(registerPlugin.mock.calls[0]![1]).toEqual({ clientOnly: true })
})
