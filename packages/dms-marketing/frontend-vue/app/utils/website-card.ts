/**
 * The Websites page's cards: a row of the websites table, as its list route
 * answers it (the stored fields and, merged in, the card the backend
 * computed), read into the card the card component and the settings modal
 * draw. Pure, so the mapping is testable without the table.
 */

import type {
  MarketingRejectedSource,
  MarketingWebsiteCard,
} from '../composables/useMarketingApi'
import type { WebsiteState } from '../composables/useMarketingContext'

/** A row of the websites table, whatever it carries. */
export type WebsiteRow = Record<string, unknown>

const WEBSITE_STATES: readonly WebsiteState[] = [
  'live',
  'imported',
  'waiting',
  'paused',
]

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function epoch(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function hosts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((host): host is string => typeof host === 'string')
    : []
}

function refused(value: unknown): MarketingRejectedSource[] {
  return Array.isArray(value)
    ? value.filter(
        (source): source is MarketingRejectedSource =>
          typeof source === 'object' &&
          source !== null &&
          typeof (source as MarketingRejectedSource).hostname === 'string',
      )
    : []
}

/**
 * The state the row's card shows. The backend sends it with the card; a row
 * read without it (its card missing) falls back on the stored switch, and
 * waits for its first pageview otherwise.
 */
function stateOf(row: WebsiteRow): WebsiteState {
  const state = row.state as WebsiteState
  if (WEBSITE_STATES.includes(state)) {
    return state
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
  }
}

/** The dot before a card's state line. */
export const WEBSITE_STATE_DOTS: Record<WebsiteState, string> = {
  live: 'bg-success',
  imported: 'bg-info',
  waiting: 'bg-warning',
  paused: 'bg-(--ui-text-dimmed)',
}

/**
 * The i18n key and parameters of a card's state line: how long ago it was
 * last seen once live or imported, the bare state otherwise. `ago` words an
 * epoch in the reader's terms ("3 min ago").
 */
export function websiteStateLine(
  card: Pick<MarketingWebsiteCard, 'state' | 'lastActivityAt'>,
  ago: (at: number) => string,
): { key: string; params?: Record<string, string> } {
  if (
    (card.state === 'live' || card.state === 'imported') &&
    card.lastActivityAt
  ) {
    return {
      key: `page.marketing.context.${card.state}`,
      params: { ago: ago(card.lastActivityAt) },
    }
  }
  return { key: `page.marketing.context.state.${card.state}` }
}
