import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { present } from './present'
import frontendModule from '../dms.frontend'
import { MODULE_CONFIG_KEY } from '../app/constants'
import {
  dashboardTrackingOptions,
  followDashboardSession,
} from '../app/utils/dashboard-tracker'

const EXCLUDED = ['/auth/**', '/settings/*']

function sdk(publicOptions: Parameters<typeof dashboardTrackingOptions>[0]) {
  return {
    options: { public: publicOptions },
    registerComponent: vi.fn(),
    registerPage: vi.fn(),
    registerDynamicPage: vi.fn(),
    registerLayout: vi.fn(),
    registerErrorPage: vi.fn(),
    registerPlugin: vi.fn(),
    registerMiddleware: vi.fn(),
    provide: vi.fn(),
    use: vi.fn(),
  }
}

describe('dashboard tracking options', () => {
  it('is off without the backend option', () => {
    expect(dashboardTrackingOptions({})).toBeNull()
    expect(dashboardTrackingOptions({ [MODULE_CONFIG_KEY]: {} })).toBeNull()
  })

  it('reads the excluded paths, strings only', () => {
    expect(
      dashboardTrackingOptions({
        [MODULE_CONFIG_KEY]: {
          dashboardTracking: { excludePaths: ['/auth/**', 3, '/a'] },
        },
      }),
    ).toEqual({ excludePaths: ['/auth/**', '/a'] })
    expect(
      dashboardTrackingOptions({
        [MODULE_CONFIG_KEY]: { dashboardTracking: {} },
      }),
    ).toEqual({ excludePaths: [] })
  })

  it('registers its client plugin only when the backend enables it', async () => {
    const off = sdk({})
    await frontendModule.setup(off)
    expect(off.registerPlugin).toHaveBeenCalledTimes(1)

    const on = sdk({
      [MODULE_CONFIG_KEY]: { dashboardTracking: { excludePaths: EXCLUDED } },
    })
    await frontendModule.setup(on)
    expect(on.registerPlugin).toHaveBeenCalledTimes(2)
    for (const [, options] of on.registerPlugin.mock.calls) {
      expect(options).toEqual({ clientOnly: true })
    }
  })
})

describe('following the signed-in workspace', () => {
  function binding(answers: Record<string, () => Promise<string>>) {
    const workspace = ref<string | null>(null)
    const applied: (string | null)[] = []
    const byWorkspace = new Map(Object.entries(answers))
    const provision = vi.fn(() =>
      present(byWorkspace.get(present(workspace.value)))(),
    )
    const stop = followDashboardSession({
      workspace: () => workspace.value,
      provision,
      apply: (websiteId) => applied.push(websiteId),
    })
    return { workspace, applied, provision, stop }
  }

  async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }

  it('asks nothing while nobody is signed in', async () => {
    const { applied, provision, stop } = binding({})
    await settle()
    expect(provision).not.toHaveBeenCalled()
    expect(applied).toEqual([null])
    stop()
  })

  it('pauses at once on a change, then reports to the new website', async () => {
    const { workspace, applied, stop } = binding({
      t1: async () => 'site-1',
      t2: async () => 'site-2',
    })
    workspace.value = 't1'
    await settle()
    expect(applied).toEqual([null, null, 'site-1'])

    workspace.value = 't2'
    expect(applied.at(-1)).toBeNull()
    await settle()
    expect(applied.at(-1)).toBe('site-2')

    workspace.value = null
    expect(applied.at(-1)).toBeNull()
    await settle()
    expect(applied.at(-1)).toBeNull()
    stop()
  })

  it('drops an answer that arrives after another change', async () => {
    let release: (id: string) => void = () => {}
    const { workspace, applied, stop } = binding({
      slow: () =>
        new Promise<string>((resolve) => {
          release = resolve
        }),
    })
    workspace.value = 'slow'
    workspace.value = null
    release('site-slow')
    await settle()
    expect(applied).not.toContain('site-slow')
    expect(applied.at(-1)).toBeNull()
    stop()
  })

  it('stays paused when the backend refuses', async () => {
    const { workspace, applied, stop } = binding({
      t1: async () => {
        throw new Error('404')
      },
    })
    workspace.value = 't1'
    await settle()
    expect(applied.at(-1)).toBeNull()
    stop()
  })
})
