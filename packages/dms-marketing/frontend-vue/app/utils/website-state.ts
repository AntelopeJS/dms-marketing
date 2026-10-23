import type { ContextWebsite } from '../composables/useMarketingContext'
import { formatRelativeTime, isJustNow } from './format'

/**
 * A website reads "live" while its last event is this recent: the backend's
 * `live` only says the tag collected once, which a site quiet for hours still
 * is.
 */
export const WEBSITE_LIVE_WINDOW_MS = 5 * 60 * 1000

/** The state a website shows: `live` only while events are recent, `idle` after. */
export type WebsiteDisplayState = ContextWebsite['state'] | 'idle'

type WebsiteActivity = Pick<ContextWebsite, 'state' | 'lastActivityAt'>

export const WEBSITE_STATE_DOTS: Record<WebsiteDisplayState, string> = {
  live: 'bg-success',
  idle: 'bg-(--ui-text-muted)',
  imported: 'bg-info',
  waiting: 'bg-warning',
  paused: 'bg-(--ui-text-dimmed)',
}

export function websiteDisplayState(
  site: WebsiteActivity,
  now: number,
): WebsiteDisplayState {
  if (
    site.state === 'live' &&
    (site.lastActivityAt === null ||
      now - site.lastActivityAt > WEBSITE_LIVE_WINDOW_MS)
  ) {
    return 'idle'
  }
  return site.state
}

type Translate = (key: string, named?: Record<string, unknown>) => string

/** A state that tells the age of its last event, when there is one. */
function showsActivity(state: WebsiteDisplayState): boolean {
  return state === 'live' || state === 'idle' || state === 'imported'
}

/**
 * The age of the last event: "2 minutes ago", "just now" under 5 seconds or
 * when the server's clock runs ahead of the reader's.
 */
function eventAge(
  at: number,
  now: number,
  t: Translate,
  locale: string,
  style?: Intl.RelativeTimeFormatStyle,
): string {
  return isJustNow(at, now)
    ? t('page.marketing.context.just_now')
    : formatRelativeTime(at, now, locale, style)
}

/** "Live · last event 2 minutes ago", "Last event 7 hours ago", "Paused"… */
export function websiteStateLine(
  site: WebsiteActivity,
  now: number,
  t: Translate,
  locale: string,
): string {
  const state = websiteDisplayState(site, now)
  if (showsActivity(state) && site.lastActivityAt) {
    return t(`page.marketing.context.${state}`, {
      ago: eventAge(site.lastActivityAt, now, t, locale),
    })
  }
  return t(`page.marketing.context.state.${site.state}`)
}

/**
 * The state line in a toolbar, beside its dot: the age of the last event
 * ("2 min ago"), else the state in a word ("Waiting", "Paused"). The full
 * line goes in its tooltip.
 */
export function websiteStateShort(
  site: WebsiteActivity,
  now: number,
  t: Translate,
  locale: string,
): string {
  const state = websiteDisplayState(site, now)
  if (showsActivity(state) && site.lastActivityAt) {
    return eventAge(site.lastActivityAt, now, t, locale, 'short')
  }
  return t(`page.marketing.context.state_short.${site.state}`)
}
