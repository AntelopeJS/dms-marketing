import { describe, expect, it } from 'vitest'
import type { MarketingWebsiteCard } from '../app/composables/useMarketingApi'
import {
  blankRequiredFields,
  draftAsksBeforeSaving,
  draftDiscardsSnapshots,
  isWebsiteDraftDirty,
  requestWebsiteSetting,
  takeWebsiteSetting,
  websiteDraftOf,
  websitePatchOf,
} from '../app/utils/website-settings'

function card(
  overrides: Partial<MarketingWebsiteCard> = {},
): MarketingWebsiteCard {
  return {
    id: 'site-1',
    name: 'Shop',
    domain: 'shop.example.com',
    state: 'live',
    lastActivityAt: 1,
    extraDomains: ['staging.example.com'],
    snapshotsEnabled: true,
    snapshotMaskText: false,
    createdAt: 1,
    sessions: 0,
    pages: 0,
    funnels: 0,
    snapshots: 4,
    sampleRate: 0.1,
    rejected: [],
    dashboard: false,
    ...overrides,
  }
}

describe('the settings draft', () => {
  it('starts from the site, a paused one with tracking off', () => {
    expect(websiteDraftOf(card())).toEqual({
      name: 'Shop',
      domain: 'shop.example.com',
      hosts: ['staging.example.com'],
      tracking: true,
      snapshots: true,
      mask: false,
    })
    expect(websiteDraftOf(card({ state: 'paused' })).tracking).toBe(false)
  })

  it('copies the hosts, so typing never edits the card', () => {
    const site = card()
    websiteDraftOf(site).hosts.push('other.example.com')
    expect(site.extraDomains).toEqual(['staging.example.com'])
  })

  it('saves trimmed values, empty hosts dropped', () => {
    expect(
      websitePatchOf({
        name: ' Shop ',
        domain: ' shop.example.com',
        hosts: [' a.example.com ', '  '],
        tracking: false,
        snapshots: false,
        mask: false,
      }),
    ).toEqual({
      name: 'Shop',
      domain: 'shop.example.com',
      extraDomains: ['a.example.com'],
      trackingEnabled: false,
      snapshotsEnabled: false,
      snapshotMaskText: false,
    })
  })

  it('requires the domain and the name, domain first', () => {
    expect(blankRequiredFields({ name: ' ', domain: '' })).toEqual([
      'domain',
      'name',
    ])
    expect(blankRequiredFields({ name: 'Shop', domain: 'a.b' })).toEqual([])
  })

  it('is dirty once a value differs, not for spaces around one', () => {
    const site = card()
    const draft = websiteDraftOf(site)
    expect(isWebsiteDraftDirty(site, draft)).toBe(false)
    expect(isWebsiteDraftDirty(site, { ...draft, name: ' Shop ' })).toBe(false)
    expect(isWebsiteDraftDirty(site, { ...draft, tracking: false })).toBe(true)
  })
})

describe('snapshot options in the modal', () => {
  it('warns when a site holding snapshots changes them', () => {
    const site = card()
    const draft = websiteDraftOf(site)
    expect(draftDiscardsSnapshots(site, draft)).toBe(false)
    expect(draftDiscardsSnapshots(site, { ...draft, mask: true })).toBe(true)
    expect(
      draftDiscardsSnapshots(card({ snapshots: 0 }), { ...draft, mask: true }),
    ).toBe(false)
  })

  it('asks before saving a change, unless it turns them on for a site with none', () => {
    const site = card()
    const draft = websiteDraftOf(site)
    expect(draftAsksBeforeSaving(site, draft)).toBe(false)
    expect(draftAsksBeforeSaving(site, { ...draft, snapshots: false })).toBe(
      true,
    )
    const none = card({ snapshotsEnabled: false, snapshots: 0 })
    expect(
      draftAsksBeforeSaving(none, { ...websiteDraftOf(none), snapshots: true }),
    ).toBe(false)
    // No snapshots yet, still a change of what later captures keep.
    expect(
      draftAsksBeforeSaving(card({ snapshots: 0 }), { ...draft, mask: true }),
    ).toBe(true)
  })
})

describe('the setting a card opens the modal on', () => {
  it('is taken once, by the modal of its own site', () => {
    requestWebsiteSetting('site-1', 'snapshots')
    // The modal of another site drops the request.
    expect(takeWebsiteSetting('site-2')).toBeUndefined()
    expect(takeWebsiteSetting('site-1')).toBeUndefined()
    requestWebsiteSetting('site-1', 'snapshots')
    expect(takeWebsiteSetting('site-1')).toBe('snapshots')
    expect(takeWebsiteSetting('site-1')).toBeUndefined()
  })
})
