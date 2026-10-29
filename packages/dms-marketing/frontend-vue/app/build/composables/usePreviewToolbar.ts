import { computed, ref, watch } from 'vue'
import { snapshotOptionItems } from '../../utils/snapshot-options'
import type { ComputedRef } from 'vue'
import type { LayoutPreset } from '../types/pagePreview'
import type { PagePreviewProps } from '../types/pagePreview'
import type { useI18n } from '#dms/frontend-module'
import type { usePreviewEmptiness } from './usePreviewEmptiness'
import type { usePreviewReads } from './usePreviewReads'
import type { usePreviewReset } from './usePreviewReset'
import type { usePreviewSnapshot } from './usePreviewSnapshot'
import type { usePreviewStatus } from './usePreviewStatus'

/** The toolbar of `PagePreview`: the overlay and layout switches, the menu, and what the surface shows. */
export function usePreviewToolbar(
  t: ReturnType<typeof useI18n>['t'],
  LAYOUT_PRESETS: LayoutPreset[],
  locale: ReturnType<typeof useI18n>['locale'],
  foreign: ComputedRef<boolean>,
  props: Readonly<PagePreviewProps>,
  updateSnapshotOptions: ReturnType<
    typeof usePreviewSnapshot
  >['updateSnapshotOptions'],
  snapshotSettingsLink: ReturnType<
    typeof usePreviewStatus
  >['snapshotSettingsLink'],
  externalUrl: ReturnType<typeof usePreviewStatus>['externalUrl'],
  resetPageHeatmap: ReturnType<typeof usePreviewReset>['resetPageHeatmap'],
  activeFailed: ReturnType<typeof usePreviewEmptiness>['activeFailed'],
  snapshot: ReturnType<typeof usePreviewSnapshot>['snapshot'],
  backdrop: ReturnType<typeof usePreviewSnapshot>['backdrop'],
  emptyState: ReturnType<typeof usePreviewEmptiness>['emptyState'],
  snapshotsEnabled: ReturnType<typeof usePreviewSnapshot>['snapshotsEnabled'],
  snapshotSettled: ReturnType<typeof usePreviewSnapshot>['snapshotSettled'],
  overlayMode: ReturnType<typeof usePreviewReads>['overlayMode'],
) {
  // --- Toolbar ------------------------------------------------------------------

  const overlayItems = computed(() => [
    {
      value: 'clicks',
      label: t('page.marketing.pages.overlay.clicks'),
      icon: 'i-ph-cursor-click',
    },
    {
      value: 'scroll',
      label: t('page.marketing.pages.overlay.scroll'),
      icon: 'i-ph-caret-double-down',
    },
  ])

  const layoutItems = computed(() =>
    LAYOUT_PRESETS.map((preset) => ({
      value: preset.width,
      label: '',
      icon: preset.icon,
    })),
  )

  /**
   * Names the icon-only layout segments: DmsSegmented renders an item's label
   * as its only text and has no per-item aria-label, so a screen reader would
   * read three unnamed radios. Set on the rendered buttons, in preset order.
   */
  const layoutSwitch = ref<HTMLElement | null>(null)

  watch(
    [layoutSwitch, locale],
    ([wrapper]) => {
      wrapper?.querySelectorAll('[role="radio"]').forEach((radio, index) => {
        const preset = LAYOUT_PRESETS[index]
        if (preset) {
          radio.setAttribute('aria-label', t(preset.labelKey))
          radio.setAttribute('title', t(preset.labelKey))
        }
      })
    },
    { flush: 'post' },
  )

  // Another workspace's page is read-only: its options and reset are its own.
  const moreItems = computed(() =>
    [
      [
        ...(foreign.value
          ? []
          : snapshotOptionItems(
              props.website,
              (patch) => void updateSnapshotOptions(patch),
              t,
            )),
        ...(snapshotSettingsLink.value
          ? [
              {
                label: t('page.marketing.pages.preview.snapshot_settings'),
                icon: 'i-ph-gear-six',
                to: snapshotSettingsLink.value,
              },
            ]
          : []),
      ],
      ...(externalUrl.value
        ? [
            [
              {
                label: t('page.marketing.pages.preview.open_in_tab'),
                icon: 'i-ph-arrow-square-out',
                to: externalUrl.value,
                target: '_blank',
              },
            ],
          ]
        : []),
      ...(foreign.value
        ? []
        : [
            [
              {
                label: t('page.marketing.pages.reset.page_button'),
                icon: 'i-ph-eraser',
                color: 'error' as const,
                onSelect: () => void resetPageHeatmap(),
              },
            ],
          ]),
    ].filter((group) => group.length > 0),
  )

  // --- Surface ----------------------------------------------------------------

  /**
   * What the left cell draws. One empty state whose texts change with the
   * reason, never several swapped in turn: replacing one DmsEmptyState by
   * another landed the new one outside the cell.
   */
  const surface = computed(() => {
    if (activeFailed.value) {
      return 'error'
    }
    if (snapshot.value && backdrop.value !== null) {
      return 'frame'
    }
    if (emptyState.value) {
      return 'empty'
    }
    if (snapshotsEnabled.value && !snapshotSettled.value) {
      return 'loading'
    }
    return 'no_backdrop'
  })

  const surfaceEmpty = computed(() => {
    if (surface.value === 'error') {
      return {
        variant: 'error' as const,
        icon: undefined,
        title: t('page.marketing.common.load_error'),
        description: undefined,
      }
    }
    if (surface.value === 'empty' && emptyState.value) {
      return {
        variant: undefined,
        icon:
          overlayMode.value === 'clicks'
            ? 'i-ph-cursor-click'
            : 'i-ph-caret-double-down',
        ...emptyState.value,
      }
    }
    return {
      variant: undefined,
      icon: 'i-ph-image-broken',
      title: t('page.marketing.pages.preview.no_backdrop'),
      description: t('page.marketing.pages.preview.no_backdrop_hint'),
    }
  })

  return {
    overlayItems,
    layoutItems,
    layoutSwitch,
    moreItems,
    surface,
    surfaceEmpty,
  }
}
