import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALL_WORKSPACES,
  effectiveWorkspace,
  rememberedWorkspace,
  rememberWorkspace,
} from '../app/utils/workspace-scope'

const OWN = { id: 'tenant-a', name: 'Alpha', current: true }
const OTHER = { id: 'tenant-b', name: 'Beta', current: false }

describe('the heatmaps workspace scope', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the own workspace without a selector: one workspace, or none offered', () => {
    expect(effectiveWorkspace(ALL_WORKSPACES, [])).toBe('')
    expect(effectiveWorkspace(OTHER.id, [OWN])).toBe('')
  })

  it('applies what the selector offers, and nothing else', () => {
    const options = [OWN, OTHER]
    expect(effectiveWorkspace(ALL_WORKSPACES, options)).toBe(ALL_WORKSPACES)
    expect(effectiveWorkspace(OTHER.id, options)).toBe(OTHER.id)
    expect(effectiveWorkspace(OWN.id, options)).toBe('')
    expect(effectiveWorkspace('tenant-gone', options)).toBe('')
    expect(effectiveWorkspace('', options)).toBe('')
  })

  it('is remembered per browser, the own workspace clearing it', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    })
    expect(rememberedWorkspace()).toBe('')
    rememberWorkspace(ALL_WORKSPACES)
    expect(rememberedWorkspace()).toBe(ALL_WORKSPACES)
    rememberWorkspace('')
    expect(rememberedWorkspace()).toBe('')
  })

  it('survives a blocked storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(rememberedWorkspace()).toBe('')
    expect(() => rememberWorkspace(ALL_WORKSPACES)).not.toThrow()
  })
})
