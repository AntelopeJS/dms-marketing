import type {
  MarketingPurgeScope,
  MarketingWebsiteDeletionImpact,
  MarketingWebsitePurge,
} from '../composables/useMarketingApi'
import { formatNumber, formatShortDate } from './format'

/** The `t` of useI18n, as far as these helpers call it. */
type Translate = (
  key: string,
  named?: Record<string, unknown>,
  plural?: number,
) => string

const PREFIX = 'page.marketing.websites.purge'

/** One line of a confirmation's impact list. */
interface ImpactLine {
  icon: string
  label: string
  count?: string
}

/**
 * The impact list of a purge confirmation: what its scope deletes, counted
 * on every period, then what it keeps. The heatmaps scope deletes clicks,
 * scroll depths and snapshots; the all scope deletes the traffic too.
 */
export function websitePurgeImpact(
  scope: MarketingPurgeScope,
  impact: MarketingWebsiteDeletionImpact,
  t: Translate,
  locale: string,
): ImpactLine[] {
  const count = (value: number) => formatNumber(value, locale)
  const heatmaps: ImpactLine[] = [
    {
      icon: 'i-ph-cursor-click',
      label: t(`${PREFIX}.heatmap_events`),
      count: count(impact.heatmapEvents),
    },
    {
      icon: 'i-ph-camera',
      label: t('page.marketing.websites.delete.snapshots'),
      count: count(impact.snapshots),
    },
  ]
  if (scope === 'heatmaps') {
    return [
      ...heatmaps,
      { icon: 'i-ph-check', label: t(`${PREFIX}.kept_traffic`) },
    ]
  }
  // Every stored day goes, so the counts read "since the oldest one".
  const since =
    impact.since === null ? null : formatShortDate(impact.since, locale)
  const sinceLabel = (key: 'sessions' | 'pageviews') =>
    since === null
      ? t(`page.marketing.websites.delete.${key}`)
      : t(`page.marketing.websites.delete.${key}_since`, { date: since })
  return [
    {
      icon: 'i-ph-users',
      label: sinceLabel('sessions'),
      count: count(impact.sessions),
    },
    {
      icon: 'i-ph-eye',
      label: sinceLabel('pageviews'),
      count: count(impact.pageviews),
    },
    ...heatmaps,
    { icon: 'i-ph-check', label: t(`${PREFIX}.kept`) },
  ]
}

/** The result toast's line: what the purge deleted. */
export function websitePurgeResult(
  answer: MarketingWebsitePurge,
  t: Translate,
  locale: string,
): string {
  const { deleted } = answer
  if (answer.scope === 'heatmaps') {
    return t(`${PREFIX}.done_heatmaps_counts`, {
      events: formatNumber(deleted.events, locale),
      snapshots: formatNumber(deleted.snapshots, locale),
    })
  }
  return t(`${PREFIX}.done_all_counts`, {
    events: formatNumber(deleted.events, locale),
    sessions: formatNumber(deleted.sessions, locale),
    snapshots: formatNumber(deleted.snapshots, locale),
  })
}
