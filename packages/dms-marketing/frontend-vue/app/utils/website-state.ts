import type { ContextWebsite } from '../composables/useMarketingContext'
import { formatRelativeTime } from './format'

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

/** "Live · last event 2 minutes ago", "Last event 7 hours ago", "Paused"… */
export function websiteStateLine(
  site: WebsiteActivity,
  now: number,
  t: (key: string, named?: Record<string, unknown>) => string,
  locale: string,
): string {
  const state = websiteDisplayState(site, now)
  if (
    (state === 'live' || state === 'idle' || state === 'imported') &&
    site.lastActivityAt
  ) {
    return t(`page.marketing.context.${state}`, {
      ago: formatRelativeTime(site.lastActivityAt, now, locale),
    })
  }
  return t(`page.marketing.context.state.${site.state}`)
}
