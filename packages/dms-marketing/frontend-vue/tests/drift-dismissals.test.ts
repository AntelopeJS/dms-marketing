import { describe, expect, it } from 'vitest'
import { dismissDrift, driftDismissed } from '../app/utils/drift-dismissals'

describe('dismissed drift warnings', () => {
  it('stay dismissed for that page of that website only', () => {
    expect(driftDismissed('site-a', '/pricing')).toBe(false)
    dismissDrift('site-a', '/pricing')
    expect(driftDismissed('site-a', '/pricing')).toBe(true)
    expect(driftDismissed('site-a', '/')).toBe(false)
    expect(driftDismissed('site-b', '/pricing')).toBe(false)
  })
})
