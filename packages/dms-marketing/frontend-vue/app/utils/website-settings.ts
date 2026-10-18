/**
 * The website settings modal's draft: what it starts from, what saving it
 * sends, and when it asks first. Pure, so the modal's rules are testable
 * without it.
 */

import type {
  MarketingWebsiteCard,
  MarketingWebsitePatch,
} from '../composables/useMarketingApi'
import type { WebsiteSetting } from '../composables/useMarketingRoutes'
import { asksBeforeSnapshotChange } from './snapshot-options'

/** The modal's two tabs. */
export type WebsiteSettingsTab = 'general' | 'danger'

/** The fields of the General tab, as typed. */
export interface WebsiteDraft {
  name: string
  domain: string
  hosts: string[]
  tracking: boolean
  snapshots: boolean
  mask: boolean
}

/** The fields the modal requires, in the order they are checked. */
export type WebsiteRequiredField = 'domain' | 'name'

/** The draft of a site, as it stands. */
export function websiteDraftOf(card: MarketingWebsiteCard): WebsiteDraft {
  return {
    name: card.name,
    domain: card.domain,
    hosts: [...card.extraDomains],
    tracking: card.state !== 'paused',
    snapshots: card.snapshotsEnabled,
    mask: card.snapshotMaskText,
  }
}

/** What saving the draft sends: trimmed, empty hosts dropped. */
export function websitePatchOf(draft: WebsiteDraft): MarketingWebsitePatch {
  return {
    name: draft.name.trim(),
    domain: draft.domain.trim(),
    extraDomains: draft.hosts.map((host) => host.trim()).filter(Boolean),
    trackingEnabled: draft.tracking,
    snapshotsEnabled: draft.snapshots,
    snapshotMaskText: draft.mask,
  }
}

/** The required fields left blank. */
export function blankRequiredFields(
  draft: Pick<WebsiteDraft, 'name' | 'domain'>,
): WebsiteRequiredField[] {
  return (['domain', 'name'] as const).filter((field) => !draft[field].trim())
}

/** Whether the draft differs from the site, for the unsaved-changes guard. */
export function isWebsiteDraftDirty(
  card: MarketingWebsiteCard,
  draft: WebsiteDraft,
): boolean {
  return (
    JSON.stringify(websitePatchOf(draft)) !==
    JSON.stringify(websitePatchOf(websiteDraftOf(card)))
  )
}

/**
 * The banner's warning: turning snapshots off, or changing the mask, of a
 * site holding some discards them.
 */
export function draftDiscardsSnapshots(
  card: MarketingWebsiteCard,
  draft: WebsiteDraft,
): boolean {
  return (
    card.snapshots > 0 &&
    (draft.snapshots !== card.snapshotsEnabled ||
      draft.mask !== card.snapshotMaskText)
  )
}

/** Whether saving the draft asks before its snapshot options change. */
export function draftAsksBeforeSaving(
  card: MarketingWebsiteCard,
  draft: WebsiteDraft,
): boolean {
  return asksBeforeSnapshotChange(
    card,
    { snapshotsEnabled: draft.snapshots, snapshotMaskText: draft.mask },
    card.snapshots,
  )
}

/**
 * A card's control that opens the modal on one setting (the snapshot pill)
 * leaves it here; the modal it opens takes it once, for its own site. A link
 * names it in the URL (`?setting=`) instead.
 */
const requested = new Map<string, WebsiteSetting>()

export function requestWebsiteSetting(
  websiteId: string,
  setting: WebsiteSetting,
): void {
  requested.clear()
  requested.set(websiteId, setting)
}

/** The setting asked for this site, forgotten once read. */
export function takeWebsiteSetting(
  websiteId: string,
): WebsiteSetting | undefined {
  const setting = requested.get(websiteId)
  requested.clear()
  return setting
}
