import { describe, expect, it } from 'vitest'
import {
  acquisitionLink,
  funnelBuilderLink,
  funnelLink,
  funnelsLink,
  installLink,
  linkInContext,
  overviewLink,
  pagesLink,
} from '../app/composables/useMarketingRoutes'

describe('module links', () => {
  it('stay bare when nothing is selected', () => {
    expect(pagesLink()).toBe('/modules/marketing/pages')
    expect(acquisitionLink()).toBe('/modules/marketing/acquisition')
    expect(funnelsLink()).toBe('/modules/marketing/funnels')
    expect(funnelBuilderLink()).toBe('/modules/marketing/funnel-builder')
    expect(installLink()).toBe('/modules/marketing/install')
  })

  it('encode the values they carry', () => {
    expect(pagesLink('/pricing?x=1')).toBe(
      '/modules/marketing/pages?path=%2Fpricing%3Fx%3D1',
    )
    expect(funnelLink('f 1')).toBe('/modules/marketing/funnel?id=f+1')
    expect(installLink('site-1')).toBe(
      '/modules/marketing/install?website=site-1',
    )
  })

  it('carry a template and the split switch to the builder', () => {
    const link = funnelBuilderLink(null, {
      split: true,
      steps: [{ kind: 'custom', value: 'signup' }],
    })
    const query = new URL(link, 'http://x').searchParams
    expect(query.get('split')).toBe('1')
    expect(JSON.parse(query.get('steps')!)).toEqual([
      { kind: 'custom', value: 'signup' },
    ])
  })

  it('opens the builder on a copy of a funnel (Duplicate)', () => {
    expect(funnelBuilderLink(null, { copy: 'f1' })).toBe(
      '/modules/marketing/funnel-builder?copy=f1',
    )
  })

  it('open the overview on a website', () => {
    expect(overviewLink()).toBe('/modules/marketing/overview')
    expect(overviewLink('site-1')).toBe(
      '/modules/marketing/overview?website=site-1',
    )
  })

  it('carry the website and the period of the page they are followed from', () => {
    const query = {
      website: 'site-1',
      'marketing.period': 'last-7-days',
      'marketing.compare': 'previous-year',
      path: '/ignored',
      from: '2026-09-01',
    }
    expect(linkInContext(pagesLink('/pricing'), query)).toBe(
      '/modules/marketing/pages?path=%2Fpricing&website=site-1&marketing.period=last-7-days&marketing.compare=previous-year',
    )
    expect(linkInContext(overviewLink('site-2'), query)).toBe(
      '/modules/marketing/overview?website=site-2&marketing.period=last-7-days&marketing.compare=previous-year',
    )
    expect(linkInContext(acquisitionLink(), {})).toBe(
      '/modules/marketing/acquisition',
    )
  })

  it('carry a custom range of the period selector', () => {
    const link = linkInContext(funnelBuilderLink(null, { copy: 'f1' }), {
      website: 'w1',
      'marketing.from': '2026-10-01',
      'marketing.to': '2026-10-11',
      'marketing.compare': 'none',
    })
    const query = new URLSearchParams(link.split('?')[1])
    expect(query.get('copy')).toBe('f1')
    expect(query.get('marketing.from')).toBe('2026-10-01')
    expect(query.get('marketing.to')).toBe('2026-10-11')
    expect(query.get('website')).toBe('w1')
  })
})
