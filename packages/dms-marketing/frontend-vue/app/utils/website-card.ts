/**
 * The Websites page's cards: a row of the websites table, as its list route
 * answers it (the stored fields and, merged in, the card the backend
 * computed), read into the card the card component and the settings modal
 * draw. Pure, so the mapping is testable without the table.
 *
 * @packageDocumentation
 */

import type {
  MarketingRejectedSource,
  MarketingWebsiteCard,
} from '../composables/useMarketingApi'
import type { WebsiteState } from '../composables/useMarketingContext'
import { isFiniteNumber, isRecord, isString } from './guards'

/**
 * A row of the websites table, whatever it carries: the fields `websiteCardOf`
 * reads, each of them read as untrusted.
 */
export interface WebsiteRow {
  readonly _id?: unknown
  readonly id?: unknown
  readonly name?: unknown
  readonly domain?: unknown
  readonly state?: unknown
  readonly lastActivityAt?: unknown
  readonly extraDomains?: unknown
  readonly trackingEnabled?: unknown
  readonly snapshotsEnabled?: unknown
  readonly snapshotMaskText?: unknown
  readonly createdAt?: unknown
  readonly sessions?: unknown
  readonly pages?: unknown
  readonly funnels?: unknown
  readonly snapshots?: unknown
  readonly sampleRate?: unknown
  readonly rejected?: unknown
  readonly dashboard?: unknown
}

function isWebsiteState(value: unknown): value is WebsiteState {
  return (
    value === 'live' ||
    value === 'imported' ||
    value === 'waiting' ||
    value === 'paused'
  )
}

function text(value: unknown): string {
  return isString(value) ? value : ''
}

function count(value: unknown): number {
  return isFiniteNumber(value) ? value : 0
}

function epoch(value: unknown): number | null {
  if (isFiniteNumber(value)) {
    return value
  }
  if (isString(value) && value) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function hosts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isString) : []
}

function refused(value: unknown): MarketingRejectedSource[] {
  return Array.isArray(value)
    ? value.filter(isRecord).flatMap((source) =>
        isString(source.hostname)
          ? [
              {
                hostname: source.hostname,
                count: count(source.count),
                lastAt: count(source.lastAt),
              },
            ]
          : [],
      )
    : []
}

/**
 * The state the row's card shows. The backend sends it with the card; a row
 * read without it (its card missing) falls back on the stored switch, and
 * waits for its first pageview otherwise.
 */
function stateOf(row: WebsiteRow): WebsiteState {
  if (isWebsiteState(row.state)) {
    return row.state
  }
  return row.trackingEnabled === false ? 'paused' : 'waiting'
}

/** The card of a websites table row, every field defaulted. */
export function websiteCardOf(row: WebsiteRow): MarketingWebsiteCard {
  return {
    id: text(row._id) || text(row.id),
    name: text(row.name),
    domain: text(row.domain),
    state: stateOf(row),
    lastActivityAt: epoch(row.lastActivityAt),
    extraDomains: hosts(row.extraDomains),
    snapshotsEnabled: row.snapshotsEnabled === true,
    snapshotMaskText: row.snapshotMaskText === true,
    createdAt: epoch(row.createdAt) ?? 0,
    sessions: count(row.sessions),
    pages: count(row.pages),
    funnels: count(row.funnels),
    snapshots: count(row.snapshots),
    sampleRate: count(row.sampleRate),
    rejected: refused(row.rejected),
    dashboard: row.dashboard === true,
  }
}
