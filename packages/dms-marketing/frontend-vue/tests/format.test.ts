import { describe, expect, it } from 'vitest'
import { contextScopeKey } from '../app/composables/useMarketingContext'
import {
  displayName,
  formatDuration,
  formatSignedDelta,
  initials,
} from '../app/utils/format'
import { sampleSizePerArm } from '../app/utils/sample-size'
import { sparklinePath } from '../app/utils/sparkline'
import { trackerSnippet } from '../app/utils/snippet'

describe('formatting', () => {
  it('writes durations the way analytics tools do', () => {
    expect(formatDuration(8)).toBe('8s')
    expect(formatDuration(168)).toBe('2m 48s')
    expect(formatDuration(3720)).toBe('1h 2m')
  })

  it('signs deltas after rounding, so a tiny change reads as flat', () => {
    expect(formatSignedDelta(-2.34, 'points', 'en')).toBe('−2.3 pt')
    expect(formatSignedDelta(8, 'seconds', 'en')).toBe('+8s')
    expect(formatSignedDelta(0.04, 'number', 'en')).toBe('±0.0')
  })

  it('names websites by their initials', () => {
    expect(initials('Acme shop')).toBe('AS')
    expect(initials('docs')).toBe('DO')
  })

  it('falls back to the raw code on a malformed region', () => {
    expect(displayName('FR', 'region', 'en')).toBe('France')
    expect(displayName('not a code!', 'region', 'en')).toBe('not a code!')
  })
})

describe('context scope key', () => {
  it('changes with the website and the refresh counter', () => {
    const base = contextScopeKey('p', 'site-a', 0)
    expect(contextScopeKey('p', 'site-b', 0)).not.toBe(base)
    expect(contextScopeKey('p', 'site-a', 1)).not.toBe(base)
    expect(contextScopeKey('p', 'site-a', 0)).toBe(base)
  })
})

describe('helpers', () => {
  it('draws a flat line for an empty or flat series', () => {
    expect(sparklinePath([], 10, 4)).toBe('M0,4 L10,4')
    expect(sparklinePath([0, 0], 10, 4)).toBe('M0.0,4.0 L10.0,4.0')
  })

  it('asks for more sessions on a rarer conversion', () => {
    expect(sampleSizePerArm(0.03, 0.2)).toBeGreaterThan(
      sampleSizePerArm(0.3, 0.2),
    )
  })

  it('builds the tracker tag for every flavour', () => {
    const html = trackerSnippet('html', 'https://dms.example.com/', 'site-1')
    expect(html).toContain(
      'src="https://dms.example.com/api/marketing/tracker.js"',
    )
    expect(html).toContain('data-website-id="site-1"')
    expect(
      trackerSnippet('gtm', 'https://dms.example.com', 'site-1'),
    ).toContain('setAttribute("data-website-id", "site-1")')
    expect(
      trackerSnippet('nuxt', 'https://dms.example.com', 'site-1'),
    ).toContain('"data-website-id": "site-1"')
  })
})
