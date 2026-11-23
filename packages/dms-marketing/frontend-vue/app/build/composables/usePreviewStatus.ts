import { computed } from 'vue'
import {
  websitesLink,
  settingsLink,
} from '../../composables/useMarketingRoutes'
import { driftDismissed, dismissDrift } from '../../utils/drift-dismissals'
import { formatShortDate } from '../../utils/format'
import type { ComputedRef } from 'vue'
import type {
  PagePreviewProps,
  StripAction,
  StatusStrip,
} from '../types/pagePreview'
import type { useI18n } from '#dms/frontend-module'
import type { usePreviewEmptiness } from './usePreviewEmptiness'
import type { usePreviewFrame } from './usePreviewFrame'
import type { usePreviewReads } from './usePreviewReads'
import type { usePreviewReset } from './usePreviewReset'
import type { usePreviewSnapshot } from './usePreviewSnapshot'

/** What `usePreviewStatus` takes from the component that calls it. */
export interface PreviewStatusOptions {
  props: Readonly<PagePreviewProps>
  snapshot: ReturnType<typeof usePreviewSnapshot>['snapshot']
  foreign: ComputedRef<boolean>
  t: ReturnType<typeof useI18n>['t']
  snapshotsEnabled: ReturnType<typeof usePreviewSnapshot>['snapshotsEnabled']
  updateSnapshotOptions: ReturnType<
    typeof usePreviewSnapshot
  >['updateSnapshotOptions']
  noSnapshotYet: ReturnType<typeof usePreviewSnapshot>['noSnapshotYet']
  tooHeavy: ReturnType<typeof usePreviewSnapshot>['tooHeavy']
  mebibytes: ReturnType<typeof usePreviewSnapshot>['mebibytes']
  DEFAULT_SNAPSHOT_BYTE_CAP: number
  overlayMode: ReturnType<typeof usePreviewReads>['overlayMode']
  drift: ReturnType<typeof usePreviewFrame>['drift']
  locale: ReturnType<typeof useI18n>['locale']
  resetPageHeatmap: ReturnType<typeof usePreviewReset>['resetPageHeatmap']
  truncatedState: ReturnType<typeof usePreviewEmptiness>['truncatedState']
  oversized: ReturnType<typeof usePreviewFrame>['oversized']
  layoutWidth: ReturnType<typeof usePreviewSnapshot>['layoutWidth']
  overflowing: ReturnType<typeof usePreviewFrame>['overflowing']
  measuredWidth: ReturnType<typeof usePreviewFrame>['measuredWidth']
}

function collectionOffStrip(options: PreviewStatusOptions): StatusStrip | null {
  const { props, t } = options
  return props.trackerEnabled
    ? null
    : {
        tone: 'error',
        icon: 'i-ph-plugs',
        title: t('page.marketing.pages.strip.collection_off'),
        description: t('page.marketing.pages.strip.collection_off_hint'),
        action: {
          label: t('page.marketing.pages.strip.open_settings'),
          to: settingsLink(),
        },
      }
}

function snapshotsOffStrip(
  options: PreviewStatusOptions,
  secondary: StripAction | undefined,
): StatusStrip | null {
  const { snapshotsEnabled, foreign, t, updateSnapshotOptions } = options
  return snapshotsEnabled.value
    ? null
    : {
        tone: 'info',
        icon: 'i-ph-camera-slash',
        title: t('page.marketing.pages.preview.snapshots_off'),
        description: t('page.marketing.pages.preview.snapshots_off_hint'),
        action: foreign.value
          ? undefined
          : {
              label: t('page.marketing.pages.preview.enable_snapshots'),
              run: () => void updateSnapshotOptions({ snapshotsEnabled: true }),
            },
        secondary,
      }
}

function noSnapshotStrip(
  options: PreviewStatusOptions,
  secondary: StripAction | undefined,
): StatusStrip | null {
  const { props, noSnapshotYet, t } = options
  return noSnapshotYet.value
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
        secondary,
      }
    : null
}

function tooHeavyStrip(
  options: PreviewStatusOptions,
  secondary: StripAction | undefined,
): StatusStrip | null {
  const { snapshot, tooHeavy, mebibytes, DEFAULT_SNAPSHOT_BYTE_CAP, t } =
    options
  return snapshot.value && tooHeavy.value
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
        secondary,
      }
    : null
}

/** One line: the share and the way out; why, and what the reset does, wait behind the info button. */
function driftStrip(
  options: PreviewStatusOptions,
  dismissedHere: boolean,
): StatusStrip | null {
  const { props, snapshot, overlayMode, drift, locale, foreign, t } = options
  const { resetPageHeatmap } = options
  if (
    overlayMode.value !== 'clicks' ||
    !drift.value?.significant ||
    dismissedHere
  ) {
    return null
  }
  return {
    tone: 'warning',
    icon: 'i-ph-git-diff',
    title: t('page.marketing.pages.preview.drift', {
      share: String(
        formatPercentage(drift.value.share, locale.value, {
          maximumFractionDigits: 0,
        }),
      ),
    }),
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
}

function oversizedStrip(options: PreviewStatusOptions): StatusStrip | null {
  const { oversized, t } = options
  return oversized.value
    ? {
        tone: 'warning',
        icon: 'i-ph-arrows-out-line-vertical',
        title: t('page.marketing.pages.preview.oversized'),
        description: t('page.marketing.pages.preview.oversized_hint'),
      }
    : null
}

function approximateLayoutStrip(
  options: PreviewStatusOptions,
): StatusStrip | null {
  const { snapshot, layoutWidth, t } = options
  return snapshot.value && !snapshot.value.exact
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
        description: t('page.marketing.pages.preview.approximate_layout_hint'),
      }
    : null
}

function overflowStrip(options: PreviewStatusOptions): StatusStrip | null {
  const { overflowing, measuredWidth, t } = options
  return overflowing.value
    ? {
        tone: 'info',
        neutral: true,
        icon: 'i-ph-arrows-horizontal',
        title: t('page.marketing.pages.preview.overflow'),
        description: t('page.marketing.pages.preview.overflow_hint', {
          width: measuredWidth.value,
        }),
      }
    : null
}

/**
 * The status strip of `PagePreview` and the lines under the snapshot: its
 * capture, its URL and its masking.
 *
 * One strip says what needs attention, highest priority first, instead of every
 * applicable alert stacked above the page; the numbers in the header stay exact
 * whatever it says. The real page is opened, never framed, on the origin the
 * snapshot was captured from, else on the site's declared domain. The site's
 * snapshot switch lives on the Websites page's settings, which the strip links
 * to; the menu's toggles are only a shortcut to it.
 */
export function usePreviewStatus(options: PreviewStatusOptions) {
  const { props, snapshot, foreign, t, truncatedState, locale } = options
  const LOCAL_HOST = /^(?:localhost|127\.|\[?::1\]?$)/

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

  const driftDismissedHere = computed(
    () => !!props.website && driftDismissed(props.website._id, props.path),
  )

  const statusStrip = computed<StatusStrip | null>(() => {
    const secondary = snapshotSettingsAction()
    const candidates: Array<StatusStrip | null> = [
      collectionOffStrip(options),
      snapshotsOffStrip(options, secondary),
      noSnapshotStrip(options, secondary),
      tooHeavyStrip(options, secondary),
      driftStrip(options, driftDismissedHere.value),
      truncatedState.value
        ? {
            tone: 'warning',
            icon: 'i-ph-warning',
            title: truncatedState.value.title,
            description: truncatedState.value.description,
          }
        : null,
      oversizedStrip(options),
      approximateLayoutStrip(options),
      overflowStrip(options),
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
