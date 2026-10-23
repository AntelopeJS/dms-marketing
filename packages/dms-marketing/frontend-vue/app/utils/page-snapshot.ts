import type {
  MarketingPageSnapshotSummary,
  MarketingSnapshotLayout,
} from '../composables/useMarketingApi'
import { formatRelativeTime, formatShortDate } from './format'

/** The `t` of useI18n, as far as these helpers call it. */
type Translate = (
  key: string,
  named?: Record<string, unknown>,
  plural?: number,
) => string

const PREFIX = 'page.marketing.pages.row_snapshot'

/** What a row of the pages list says of its path's snapshot. */
export interface PageSnapshotBadge {
  icon: string
  label: string
  /** The full sentence, for the tooltip and assistive technology. */
  title: string
  /** Muted when there is nothing to show. */
  muted: boolean
}

function layoutNames(layouts: MarketingSnapshotLayout[], t: Translate): string {
  return layouts
    .map((layout) =>
      t(`page.marketing.pages.preview.layout_${layout}`).toLowerCase(),
    )
    .join(', ')
}

/**
 * The row's snapshot mark: its age, or that the page has none or is too
 * heavy. `undefined` is a site with snapshots off — the rows say nothing,
 * the preview's strip says why.
 */
export function pageSnapshotBadge(
  snapshot: MarketingPageSnapshotSummary | null | undefined,
  now: number,
  t: Translate,
  locale: string,
): PageSnapshotBadge | null {
  if (snapshot === undefined) {
    return null
  }
  if (snapshot === null) {
    return {
      icon: 'i-ph-camera-slash',
      label: t(`${PREFIX}.none`),
      title: t(`${PREFIX}.none_title`),
      muted: true,
    }
  }
  const date = formatShortDate(snapshot.capturedAt, locale)
  if (snapshot.tooHeavy) {
    return {
      icon: 'i-ph-file-x',
      label: t(`${PREFIX}.too_heavy`),
      title: t(`${PREFIX}.too_heavy_title`, { date }),
      muted: true,
    }
  }
  return {
    icon: 'i-ph-camera',
    label: formatRelativeTime(snapshot.capturedAt, now, locale, 'short'),
    title: t(
      `${PREFIX}.title`,
      { date, layouts: layoutNames(snapshot.layouts, t) },
      snapshot.layouts.length,
    ),
    muted: false,
  }
}
