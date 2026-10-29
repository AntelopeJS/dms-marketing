import type {
  MarketingFunnelListItem,
  MarketingPeriod,
  MarketingSnapshotLayout,
  MarketingWebsite,
} from '../../composables/useMarketingApi'
import type { AnchorBox } from '../../composables/useSnapshotFrame'

/** The props of `PagePreview`. */
export interface PagePreviewProps {
  website: MarketingWebsite | null
  path: string
  /** Days the counts cover — the context bar's period scope. */
  period: MarketingPeriod
  /**
   * Measured share of the site's page loads sampled for clicks, written for
   * a sentence — why a quiet page looks empty. Null while too few pageviews
   * tell it.
   */
  sampleRateLabel: string | null
  trackerEnabled: boolean
  /** Pageviews of this path over the window, for the sampling hint. */
  pageviews?: number
  /** Funnels with a page step on this path. */
  usedIn?: MarketingFunnelListItem[]
  /**
   * Height the card fills, toolbar to bottom, the snapshot scrolling inside
   * it whatever its length (see PagesExplorer). Null or absent: the card
   * grows with the snapshot, as when it is stacked under the list.
   */
  height?: number | null
  /**
   * Another workspace's dashboard, or `all` (see PagesExplorer): the page is
   * read there, read-only — no reset, no snapshot option — and its capture
   * comes masked from the backend. Absent or empty: the website's own.
   */
  workspace?: string
  /** Whether any site of that scope keeps snapshots. */
  workspaceSnapshots?: boolean
}

/** A layout the preview can be read at, and its width. */
export interface LayoutPreset {
  width: number
  layout: MarketingSnapshotLayout
  icon: string
  labelKey: string
}

/** An action of the status strip of `PagePreview`. */
export interface StripAction {
  label: string
  run?: () => void
  to?: string
}

/** The one status strip `PagePreview` shows above the snapshot. */
export interface StatusStrip {
  tone: 'error' | 'warning' | 'info' | 'primary' | 'success'
  neutral?: boolean
  icon: string
  title: string
  description?: string
  /** The explanation, behind an info button instead of under the title: a
   * strip that must stay one line above the snapshot. */
  details?: string
  action?: StripAction
  /** A second, quieter action: the setting behind the strip, where it lives. */
  secondary?: StripAction
  /** Closes the strip; the next one that applies, if any, takes its place. */
  dismiss?: () => void
}

/** One of the most clicked elements of the page, grouped by anchor. */
export interface ClickedElement {
  key: string
  selector: string
  weight: number
  text: string
  box: AnchorBox | undefined
}

/** A pin `PagePreview` draws on a most clicked element. */
export interface Pin {
  key: string
  weight: number
  left: number
  top: number
}
