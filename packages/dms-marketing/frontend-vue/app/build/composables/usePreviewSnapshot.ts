import { ref, computed } from 'vue'
import {
  type MarketingSnapshotLayout,
  type MarketingWebsite,
  type MarketingWebsitePatch,
} from '../../composables/useMarketingApi'
import {
  usePageSnapshot,
  useHeatmapCountRead,
} from '../../composables/useMarketingReads'
import { rewriteViewportUnits } from '../../utils/snapshotViewportUnits'
import { confirmSnapshotChange } from '../../utils/snapshot-options'
import type { ComputedRef } from 'vue'
import type { LayoutPreset } from '../types/pagePreview'
import type { PagePreviewProps } from '../types/pagePreview'
import type { useI18n } from '#dms/frontend-module'
import type { useMarketingApi } from '../../composables/useMarketingApi'
import type { usePreviewReset } from './usePreviewReset'

/** The snapshot of `PagePreview`: the layout read, the capture behind the overlay and the site's snapshot options. */
export function usePreviewSnapshot(
  DEFAULT_LAYOUT_WIDTH: number,
  LAYOUT_PRESETS: LayoutPreset[],
  foreign: ComputedRef<boolean>,
  props: Readonly<PagePreviewProps>,
  locale: ReturnType<typeof useI18n>['locale'],
  confirm: ReturnType<typeof usePreviewReset>['confirm'],
  t: ReturnType<typeof useI18n>['t'],
  emit: (event: 'website-updated', website: MarketingWebsite) => void,
  api: ReturnType<typeof useMarketingApi>,
  toast: ReturnType<typeof usePreviewReset>['toast'],
) {
  // --- Snapshot ---------------------------------------------------------------

  const layoutWidth = ref(DEFAULT_LAYOUT_WIDTH)

  const layout = computed<MarketingSnapshotLayout>(
    () =>
      LAYOUT_PRESETS.find((preset) => preset.width === layoutWidth.value)
        ?.layout ?? 'desktop',
  )

  const snapshotsEnabled = computed(() =>
    foreign.value
      ? props.workspaceSnapshots === true
      : (props.website?.snapshotsEnabled ?? false),
  )

  // Not fetched while the site has snapshots off: the option's banner is the
  // whole story then, and a leftover capture must not contradict it.
  const snapshotRead = usePageSnapshot({
    websiteId: () => props.website?._id,
    path: () => props.path,
    layout,
    enabled: snapshotsEnabled,
    maskText: () => props.website?.snapshotMaskText === true,
    workspace: () => props.workspace,
  })
  const isSnapshotAsked = computed(
    () => snapshotsEnabled.value && !!props.website?._id && !!props.path,
  )
  /** A capture was asked and answered, or there is none to ask for. */
  const snapshotSettled = computed(
    () =>
      !isSnapshotAsked.value ||
      snapshotRead.status.value === 'success' ||
      snapshotRead.status.value === 'error',
  )

  const snapshot = computed(() =>
    snapshotRead.error.value
      ? null
      : (snapshotRead.data.value?.snapshot ?? null),
  )

  const backdrop = computed(() => snapshot.value?.html ?? null)

  /** The document the frame renders: the capture, its viewport units fixed
   *  to the visitor's screen at the width being looked at. */
  const frameDocument = computed(() =>
    snapshot.value && backdrop.value !== null
      ? rewriteViewportUnits(backdrop.value, {
          width: layoutWidth.value,
          height: snapshot.value.viewport.height,
        })
      : '',
  )
  const noSnapshotYet = computed(
    () =>
      snapshotsEnabled.value &&
      snapshotSettled.value &&
      snapshot.value === null,
  )
  const tooHeavy = computed(
    () => snapshot.value !== null && backdrop.value === null,
  )
  const snapshotScheme = computed(() => snapshot.value?.colorScheme ?? 'light')

  function mebibytes(bytes: number): string {
    return new Intl.NumberFormat(locale.value, {
      maximumFractionDigits: 1,
    }).format(bytes / (1024 * 1024))
  }

  const savingOptions = ref(false)

  const countSiteHeatmap = useHeatmapCountRead(() => props.website?._id ?? '')

  /**
   * Whether the change may go ahead: it deletes the site's snapshots and
   * changes what later captures keep, so it is asked first — with the count
   * when there are some (see asksBeforeSnapshotChange). Declining leaves the
   * website as it is, and the menu's checkbox with it.
   */
  function confirmSnapshotDiscard(
    website: MarketingWebsite,
    patch: MarketingWebsitePatch,
  ): Promise<boolean> {
    return confirmSnapshotChange(website, patch, {
      count: async () => {
        savingOptions.value = true
        try {
          return (await countSiteHeatmap()).snapshots
        } finally {
          savingOptions.value = false
        }
      },
      confirm,
      t,
    })
  }

  async function updateSnapshotOptions(
    patch: MarketingWebsitePatch,
  ): Promise<void> {
    const website = props.website
    if (!website || !(await confirmSnapshotDiscard(website, patch))) {
      return
    }
    savingOptions.value = true
    try {
      emit('website-updated', await api.updateWebsite(website._id, patch))
    } catch {
      toast.add({
        color: 'error',
        title: t('page.marketing.pages.preview.options_error'),
      })
    } finally {
      savingOptions.value = false
    }
  }

  return {
    layoutWidth,
    layout,
    snapshotsEnabled,
    snapshotSettled,
    snapshot,
    backdrop,
    frameDocument,
    noSnapshotYet,
    tooHeavy,
    snapshotScheme,
    mebibytes,
    savingOptions,
    updateSnapshotOptions,
  }
}
