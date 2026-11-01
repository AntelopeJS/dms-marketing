import { computed } from 'vue'
import {
  websitesLink,
  settingsLink,
} from '../../composables/useMarketingRoutes'
import { type StripAction, type StatusStrip } from '../types/pagePreview'
import { driftDismissed, dismissDrift } from '../../utils/drift-dismissals'
import { formatShortDate } from '../../utils/format'
import type { ComputedRef } from 'vue'
import type { PagePreviewProps } from '../types/pagePreview'
import type { useI18n } from '#dms/frontend-module'
import type { usePreviewEmptiness } from './usePreviewEmptiness'
import type { usePreviewFrame } from './usePreviewFrame'
import type { usePreviewReads } from './usePreviewReads'
import type { usePreviewReset } from './usePreviewReset'
import type { usePreviewSnapshot } from './usePreviewSnapshot'

/** The status strip of `PagePreview` and the lines under the snapshot: its capture, its URL and its masking. */
export function usePreviewStatus(
  props: Readonly<PagePreviewProps>,
  snapshot: ReturnType<typeof usePreviewSnapshot>['snapshot'],
  foreign: ComputedRef<boolean>,
  t: ReturnType<typeof useI18n>['t'],
  snapshotsEnabled: ReturnType<typeof usePreviewSnapshot>['snapshotsEnabled'],
  updateSnapshotOptions: ReturnType<
    typeof usePreviewSnapshot
  >['updateSnapshotOptions'],
  noSnapshotYet: ReturnType<typeof usePreviewSnapshot>['noSnapshotYet'],
  tooHeavy: ReturnType<typeof usePreviewSnapshot>['tooHeavy'],
  mebibytes: ReturnType<typeof usePreviewSnapshot>['mebibytes'],
  DEFAULT_SNAPSHOT_BYTE_CAP: number,
  overlayMode: ReturnType<typeof usePreviewReads>['overlayMode'],
  drift: ReturnType<typeof usePreviewFrame>['drift'],
  locale: ReturnType<typeof useI18n>['locale'],
  resetPageHeatmap: ReturnType<typeof usePreviewReset>['resetPageHeatmap'],
  truncatedState: ReturnType<typeof usePreviewEmptiness>['truncatedState'],
  oversized: ReturnType<typeof usePreviewFrame>['oversized'],
  layoutWidth: ReturnType<typeof usePreviewSnapshot>['layoutWidth'],
  overflowing: ReturnType<typeof usePreviewFrame>['overflowing'],
  measuredWidth: ReturnType<typeof usePreviewFrame>['measuredWidth'],
) {
  const LOCAL_HOST = /^(localhost|127\.|\[?::1\]?$)/

  /** The real page — opened, never framed: on the origin the snapshot was
   *  captured from, else on the site's declared domain. */
  const externalUrl = computed(() => {
    const domain = props.website?.domain
    const origin =
      snapshot.value?.origin ??
      (domain
        ? `${LOCAL_HOST.test(domain) ? 'http' : 'https'}://${domain}`
        : null)
    if (!origin || !props.path) {
      return ''
    }
    try {
      return new URL(props.path, origin).toString()
    } catch {
      return ''
    }
  })

  // --- One status strip -------------------------------------------------------

  /** Where the site's snapshot switch lives: the Websites page's settings,
   * scrolled to it. The menu's toggles are only a shortcut to it. */
  const snapshotSettingsLink = computed(() =>
    props.website && !foreign.value
      ? websitesLink(props.website._id, 'snapshots')
      : '',
  )

  function snapshotSettingsAction(): StripAction | undefined {
    return snapshotSettingsLink.value
      ? {
          label: t('page.marketing.pages.preview.snapshot_settings'),
          to: snapshotSettingsLink.value,
        }
      : undefined
  }

  /** The drift strip was closed on this page this session (see
   * drift-dismissals). */
  const driftDismissedHere = computed(
    () => !!props.website && driftDismissed(props.website._id, props.path),
  )

  /**
   * Highest priority first: one strip says what needs attention, instead of
   * every applicable alert stacked above the page. The numbers in the header
   * stay exact whatever it says.
   */
  const statusStrip = computed<StatusStrip | null>(() => {
    const candidates: Array<StatusStrip | null> = [
      !props.trackerEnabled
        ? {
            tone: 'error',
            icon: 'i-ph-plugs',
            title: t('page.marketing.pages.strip.collection_off'),
            description: t('page.marketing.pages.strip.collection_off_hint'),
            action: {
              label: t('page.marketing.pages.strip.open_settings'),
              to: settingsLink(),
            },
          }
        : null,
      !snapshotsEnabled.value
        ? {
            tone: 'info',
            icon: 'i-ph-camera-slash',
            title: t('page.marketing.pages.preview.snapshots_off'),
            description: t('page.marketing.pages.preview.snapshots_off_hint'),
            action: foreign.value
              ? undefined
              : {
                  label: t('page.marketing.pages.preview.enable_snapshots'),
                  run: () =>
                    void updateSnapshotOptions({ snapshotsEnabled: true }),
                },
            secondary: snapshotSettingsAction(),
          }
        : null,
      noSnapshotYet.value
        ? {
            tone: 'primary',
            icon: 'i-ph-hourglass',
            title: t('page.marketing.pages.preview.no_snapshot'),
            description:
              props.sampleRateLabel === null
                ? t('page.marketing.pages.preview.no_snapshot_hint')
                : t('page.marketing.pages.preview.no_snapshot_hint_rate', {
                    rate: props.sampleRateLabel,
                  }),
            secondary: snapshotSettingsAction(),
          }
        : null,
      snapshot.value && tooHeavy.value
        ? {
            tone: 'warning',
            icon: 'i-ph-file-x',
            title: t('page.marketing.pages.preview.too_heavy'),
            description: t('page.marketing.pages.preview.too_heavy_hint', {
              size: mebibytes(snapshot.value.bytes),
              limit: mebibytes(
                snapshot.value.maxBytes ?? DEFAULT_SNAPSHOT_BYTE_CAP,
              ),
            }),
            secondary: snapshotSettingsAction(),
          }
        : null,
      overlayMode.value === 'clicks' &&
      drift.value?.significant &&
      !driftDismissedHere.value
        ? {
            tone: 'warning',
            icon: 'i-ph-git-diff',
            title: t('page.marketing.pages.preview.drift', {
              share: String(
                formatPercentage(drift.value.share, locale.value, {
                  maximumFractionDigits: 0,
                }),
              ),
            }),
            // One line: the share and the way out. Why, and what the reset
            // does, wait behind the info button.
            details: t('page.marketing.pages.preview.drift_hint', {
              date: snapshot.value
                ? formatShortDate(snapshot.value.capturedAt, locale.value)
                : '',
            }),
            action: foreign.value
              ? undefined
              : {
                  label: t('page.marketing.pages.reset.page_button'),
                  run: () => void resetPageHeatmap(),
                },
            dismiss: () => {
              if (props.website) {
                dismissDrift(props.website._id, props.path)
              }
            },
          }
        : null,
      truncatedState.value
        ? {
            tone: 'warning',
            icon: 'i-ph-warning',
            title: truncatedState.value.title,
            description: truncatedState.value.description,
          }
        : null,
      oversized.value
        ? {
            tone: 'warning',
            icon: 'i-ph-arrows-out-line-vertical',
            title: t('page.marketing.pages.preview.oversized'),
            description: t('page.marketing.pages.preview.oversized_hint'),
          }
        : null,
      snapshot.value && !snapshot.value.exact
        ? {
            tone: 'info',
            neutral: true,
            icon: 'i-ph-arrows-out-line-horizontal',
            title: t('page.marketing.pages.preview.approximate_layout', {
              layout: t(
                `page.marketing.pages.preview.layout_${snapshot.value.layout}`,
              ).toLowerCase(),
              width: layoutWidth.value,
            }),
            description: t(
              'page.marketing.pages.preview.approximate_layout_hint',
            ),
          }
        : null,
      overflowing.value
        ? {
            tone: 'info',
            neutral: true,
            icon: 'i-ph-arrows-horizontal',
            title: t('page.marketing.pages.preview.overflow'),
            description: t('page.marketing.pages.preview.overflow_hint', {
              width: measuredWidth.value,
            }),
          }
        : null,
    ]
    return candidates.find((candidate) => candidate !== null) ?? null
  })

  const statusLine = computed(() => {
    if (!snapshot.value) {
      return ''
    }
    const layoutLabel = t(
      `page.marketing.pages.preview.layout_${snapshot.value.layout}`,
    ).toLowerCase()
    return t('page.marketing.pages.preview.status_line', {
      date: formatShortDate(snapshot.value.capturedAt, locale.value),
      layout: layoutLabel,
      width: snapshot.value.viewport.width,
    })
  })

  /** Where the snapshot was taken: origin and path, as stored. */
  const capturedUrl = computed(() =>
    snapshot.value
      ? (snapshot.value.url ?? `${snapshot.value.origin}${props.path}`)
      : '',
  )

  const maskLine = computed(() => {
    if (snapshot.value?.masked || foreign.value) {
      return t('page.marketing.pages.preview.workspace_masked')
    }
    return t(
      props.website?.snapshotMaskText
        ? 'page.marketing.pages.preview.all_masked'
        : 'page.marketing.pages.preview.fields_masked',
    )
  })

  return {
    externalUrl,
    snapshotSettingsLink,
    statusStrip,
    statusLine,
    capturedUrl,
    maskLine,
  }
}
