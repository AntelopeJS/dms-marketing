<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '#dms/frontend-module'
import { useMarketingApi, type MarketingWebsite } from '../composables/useMarketingApi'
import { formatNumber } from '../utils/format'
import type { LayoutPreset, PagePreviewProps } from '../build/types/pagePreview'
import PagePreviewStrip from '../build/components/page-preview/PagePreviewStrip.vue'
import PagePreviewLegend from '../build/components/page-preview/PagePreviewLegend.vue'
import { usePreviewToolbar } from '../build/composables/usePreviewToolbar'
import { usePreviewPins } from '../build/composables/usePreviewPins'
import { usePreviewStatus } from '../build/composables/usePreviewStatus'
import { usePreviewEmptiness } from '../build/composables/usePreviewEmptiness'
import { usePreviewScale } from '../build/composables/usePreviewScale'
import { usePreviewFrame } from '../build/composables/usePreviewFrame'
import { usePreviewSnapshot } from '../build/composables/usePreviewSnapshot'
import { usePreviewReset } from '../build/composables/usePreviewReset'
import { usePreviewReads } from '../build/composables/usePreviewReads'

/**
 * Click and scroll-depth overlays of one tracked page, over a snapshot of
 * that page. The two overlays switch above ONE persistent frame — plain
 * buttons, never a Tab block, whose default unmounting of hidden slots would
 * tear the frame down and re-measure it on every switch.
 *
 * The invariant of this surface: THE NUMBERS NEVER DEGRADE. Points, weights
 * and totals come from the database; the snapshot is the surface they are
 * drawn on. Without one — snapshots off for the site, no sampled visit
 * captured yet — nothing is drawn: the counts stay in the header, the
 * banner says why the page has no backdrop and when it will, and no empty
 * pane pretends to be a page.
 *
 * The wallpaper is a captured DOM, not the live site: what a sampled visitor
 * saw, rendered in a `srcdoc` frame sandboxed without scripts. Same-origin,
 * so its geometry is read directly; inert, so pointer events never reach it
 * and nothing in it can be clicked, hovered or navigated. Interacting with
 * the real page goes through "open in a new tab".
 *
 * ## Geometry
 *
 * The frame is laid out at the chosen width and pinned to the captured
 * viewport height until the snapshot's size is read (see useSnapshotFrame)
 * — never at the height it is about to report, which is what would make
 * every `100vh` page grow without bound. Once a size is published the frame
 * expands to it, once. Viewport-relative units are rewritten to the pixels
 * they had in the visitor's viewport before the document is rendered (see
 * rewriteViewportUnits), so the reading is the visitor's page height and
 * the resize changes nothing inside. The frame is remounted (`:key`)
 * whenever the snapshot or the layout width changes, so the composable
 * re-arms on a fresh document.
 */
const props = defineProps<PagePreviewProps>()

/** Read past the viewer's workspace (see `workspace`). */
const foreign = computed(() => !!props.workspace)

/** The site's snapshot options were saved here, as the backend answered
 * them; the parent owns the row. */
const emit = defineEmits<{
  'website-updated': [website: MarketingWebsite]
}>()


/**
 * Layouts offered for inspection; a mobile layout is a different page. The
 * tablet is upright on purpose: lying flat it is 1024+ wide, a width most
 * breakpoints already dress as desktop — the button would repeat 1280.
 */
const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    width: 1280,
    layout: 'desktop',
    icon: 'i-ph-monitor',
    labelKey: 'page.marketing.pages.preview.layout_desktop',
  },
  {
    width: 768,
    layout: 'tablet',
    icon: 'i-ph-device-tablet',
    labelKey: 'page.marketing.pages.preview.layout_tablet',
  },
  {
    width: 390,
    layout: 'phone',
    icon: 'i-ph-device-mobile',
    labelKey: 'page.marketing.pages.preview.layout_phone',
  },
]
const DEFAULT_LAYOUT_WIDTH = 1280
/** Viewport the snapshot is measured through when it recorded none. */
const PROBE_VIEWPORT_HEIGHT = 900
/** Height of the scrollable pane the scaled surface lives in. */
const PANE_HEIGHT = 620
/** Overflow beyond the chosen layout width worth telling the operator about. */
const OVERFLOW_TOLERANCE = 1.05
/** The upload cap of a backend that does not say its own. */
const DEFAULT_SNAPSHOT_BYTE_CAP = 1024 * 1024
const LIGHT_CANVAS = '#ffffff'
const DARK_CANVAS = '#111111'

const api = useMarketingApi()
const { t, locale } = useI18n()

const { heatmapRead, heatmap, loading, failed, points, maxWeight, totalClicks, overlayMode, scrollRead, scrollDepth, loadingScroll, scrollFailed, scrollViews, scrollReached, medianDepth } = usePreviewReads(props)

/**
 * Where depth 0 sits on the drawn page: the bottom of the first screen.
 * Depth is a fraction of the visitor's scrollable range; the captured
 * viewport stands in for the visitors' real ones, so the overlay claims
 * bands, not pixels.
 */
const scrollFoldRatio = computed(() =>
  renderHeight.value > 0
    ? Math.min(probeHeight.value / renderHeight.value, 1)
    : 1,
)

const { confirm, resetting, resetPageHeatmap } = usePreviewReset(props, t, locale, api)

const { layoutWidth, layout, snapshotsEnabled, snapshotSettled, snapshot, backdrop, frameDocument, noSnapshotYet, tooHeavy, snapshotScheme, mebibytes, savingOptions, updateSnapshotOptions } = usePreviewSnapshot(DEFAULT_LAYOUT_WIDTH, LAYOUT_PRESETS, foreign, props, locale, confirm, t, emit, api)

const { frame, measuredWidth, frameKey, probeHeight, renderHeight, frameHeight, overlayWidth, anchorBoxes, anchorKey, drawnPoints, drift, oversized, overflowing } = usePreviewFrame(props, snapshot, layoutWidth, PROBE_VIEWPORT_HEIGHT, points, OVERFLOW_TOLERANCE)

const { container, containerWidth, scale, surfaceWidth, scrolledHeight, filled, paneStyle } = usePreviewScale(layoutWidth, renderHeight, props)

const { emptyState, activeFailed, activeLoading, retryActive, truncatedState } = usePreviewEmptiness(props, t, scrollViews, overlayMode, loading, heatmap, totalClicks, loadingScroll, scrollDepth, failed, scrollFailed, heatmapRead, scrollRead)

const { externalUrl, snapshotSettingsLink, statusStrip, statusLine, capturedUrl, maskLine } = usePreviewStatus(props, snapshot, foreign, t, snapshotsEnabled, updateSnapshotOptions, noSnapshotYet, tooHeavy, mebibytes, DEFAULT_SNAPSHOT_BYTE_CAP, overlayMode, drift, locale, resetPageHeatmap, truncatedState, oversized, layoutWidth, overflowing, measuredWidth)

const { mostClicked, pins } = usePreviewPins(points, anchorKey, anchorBoxes, overlayMode, scale, layoutWidth)

const { overlayItems, layoutItems, layoutSwitch, moreItems, surface, surfaceEmpty } = usePreviewToolbar(t, LAYOUT_PRESETS, locale, foreign, props, updateSnapshotOptions, snapshotSettingsLink, externalUrl, resetPageHeatmap, activeFailed, snapshot, backdrop, emptyState, snapshotsEnabled, snapshotSettled, overlayMode)
</script>

<template>
  <section
    class="dms-card flex min-w-0 flex-col overflow-hidden p-0"
    :style="filled ? { height: `${props.height}px` } : undefined"
  >
    <!-- Toolbar -->
    <header
      class="flex flex-wrap items-center justify-between gap-3 border-b border-default px-4 py-3"
    >
      <div class="min-w-0 flex-1 basis-64">
        <p
          class="flex min-w-0 items-center gap-2 font-mono text-base font-semibold text-highlighted"
        >
          <span class="min-w-0 truncate" :title="props.path">
            {{ props.path }}
          </span>
          <UButton
            v-if="externalUrl"
            :to="externalUrl"
            target="_blank"
            icon="i-ph-arrow-square-out"
            size="xs"
            color="neutral"
            variant="ghost"
            class="shrink-0"
            :aria-label="t('page.marketing.pages.preview.open_in_tab')"
          />
        </p>
        <p class="flex flex-wrap gap-x-3 text-xs text-muted">
          <span v-if="props.pageviews !== undefined">
            <b class="font-mono text-highlighted">
              {{ formatNumber(props.pageviews, locale) }}
            </b>
            {{ t('page.marketing.pages.views_unit', props.pageviews) }}
          </span>
          <span>
            <b class="font-mono text-highlighted">
              {{ formatNumber(totalClicks, locale) }}
            </b>
            {{ t('page.marketing.pages.clicks_unit', totalClicks) }}
          </span>
          <span v-if="scrollDepth !== null">
            <b class="font-mono text-highlighted">
              {{ formatNumber(scrollViews, locale) }}
            </b>
            {{ t('page.marketing.pages.sampled_unit', scrollViews) }}
          </span>
        </p>
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <DmsSegmented
          v-model="overlayMode"
          :items="overlayItems"
          size="xs"
          :aria-label="t('page.marketing.pages.overlay.label')"
        />
        <span ref="layoutSwitch" class="contents">
          <DmsSegmented
            v-model="layoutWidth"
            :items="layoutItems"
            size="xs"
            :aria-label="t('page.marketing.pages.preview.layout')"
          />
        </span>
        <UDropdownMenu
          v-if="moreItems.length > 0"
          :items="moreItems"
          :content="{ align: 'end' }"
        >
          <UButton
            icon="i-ph-dots-three"
            size="xs"
            color="neutral"
            variant="ghost"
            :loading="savingOptions || resetting"
            :aria-label="t('page.marketing.pages.preview.more')"
          />
        </UDropdownMenu>
      </div>
    </header>

    <!-- One status line, or the one strip that needs attention -->
    <PagePreviewStrip
      v-if="statusStrip"
      :status-strip="statusStrip"
      :saving-options="savingOptions"
    />
    <p
      v-else-if="snapshot"
      class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-default px-4 py-2 text-xs text-muted"
    >
      <span class="flex items-center gap-1.5">
        <UIcon name="i-ph-camera" class="size-3.5 text-success" />
        {{ statusLine }}
      </span>
      <span
        class="min-w-0 truncate font-mono text-dimmed"
        :title="t('page.marketing.pages.preview.captured_from_hint')"
      >
        {{
          t('page.marketing.pages.preview.captured_from', { url: capturedUrl })
        }}
      </span>
      <span class="text-dimmed">· {{ maskLine }}</span>
      <UButton
        v-if="snapshotSettingsLink"
        :to="snapshotSettingsLink"
        size="xs"
        color="neutral"
        variant="link"
        icon="i-ph-gear-six"
        class="ms-auto"
        :label="t('page.marketing.pages.preview.snapshot_settings')"
      />
    </p>
    <!-- The status line's place while the capture is read, at its height (a
         text-xs line): arriving in a free row, it pushed the pane down. -->
    <p
      v-else-if="!snapshotSettled"
      class="flex items-center border-b border-default px-4 py-2"
      aria-hidden="true"
    >
      <USkeleton class="h-4 w-72 max-w-full" />
    </p>

    <div
      class="grid min-h-0 xl:grid-cols-[minmax(0,1fr)_15rem]"
      :class="filled ? 'flex-1 xl:grid-rows-[minmax(0,1fr)]' : ''"
    >
      <div class="flex min-h-0 min-w-0 flex-col p-3">
        <USkeleton
          v-if="surface === 'loading'"
          class="w-full rounded-lg"
          :class="filled ? 'min-h-0 flex-1' : ''"
          :style="filled ? undefined : { height: `${PANE_HEIGHT}px` }"
        />

        <!-- Kept mounted across refetches: tearing it down would re-render the
             snapshot — and re-measure it — on every period change. -->
        <div
          v-else-if="surface === 'frame'"
          class="relative"
          :class="filled ? 'min-h-0 flex-1' : ''"
        >
          <div
            ref="container"
            class="overflow-x-hidden overflow-y-scroll rounded-lg border border-default bg-elevated"
            :class="
              filled
                ? 'bg-[repeating-linear-gradient(135deg,transparent_0_8px,var(--ui-border)_8px_9px)]'
                : ''
            "
            :style="paneStyle"
          >
            <!-- A layout narrower than the pane keeps its width, centred. -->
            <div
              class="relative mx-auto overflow-hidden"
              :class="
                surfaceWidth < containerWidth ? 'ring-1 ring-accented' : ''
              "
              :style="{
                width: `${surfaceWidth}px`,
                height: `${scrolledHeight}px`,
              }"
            >
              <div
                class="absolute top-0 left-0"
                :style="{
                  width: `${layoutWidth}px`,
                  height: `${renderHeight}px`,
                  zoom: scale,
                }"
              >
                <!-- Inert on purpose: pointer-events none means no link, form or
                     hover state inside the snapshot can fire. The sandbox allows
                     same-origin and nothing else — no script, no form, no
                     navigation — which is what lets useSnapshotFrame read the
                     document while a capture that arrived through a public
                     endpoint stays inert. Hidden from assistive technology:
                     "Most clicked" is its readable alternative. -->
                <iframe
                  :key="frameKey"
                  ref="frame"
                  :srcdoc="frameDocument"
                  class="pointer-events-none absolute top-0 left-0 w-full border-0"
                  :style="{
                    height: `${frameHeight}px`,
                    colorScheme: snapshotScheme,
                    backgroundColor:
                      snapshotScheme === 'dark' ? DARK_CANVAS : LIGHT_CANVAS,
                  }"
                  sandbox="allow-same-origin"
                  scrolling="no"
                  referrerpolicy="no-referrer"
                  aria-hidden="true"
                  tabindex="-1"
                  inert
                  :title="props.path"
                />
                <DmsMarketingHeatmapCanvas
                  v-if="overlayMode === 'clicks'"
                  :points="drawnPoints"
                  :max-weight="maxWeight"
                  :width="overlayWidth"
                  :height="renderHeight"
                />
                <span
                  v-for="pin in pins"
                  :key="pin.key"
                  aria-hidden="true"
                  class="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-neutral-900/90 px-2 py-0.5 font-mono font-semibold text-white shadow"
                  :style="{
                    left: `${pin.left * scale}px`,
                    top: `${pin.top * scale}px`,
                    zoom: 1 / scale,
                    fontSize: '12px',
                  }"
                >
                  <span class="size-1.5 rounded-full bg-red-500" />
                  {{ formatNumber(pin.weight, locale) }}
                </span>
              </div>

              <!-- In the pane's scaled space, not the document's: depth only
                   varies vertically, and the labels must not shrink with the
                   page — see the component. -->
              <DmsMarketingScrollDepthOverlay
                v-if="overlayMode === 'scroll' && scrollViews > 0"
                :reached="scrollReached"
                :views="scrollViews"
                :height="scrolledHeight"
                :fold-ratio="scrollFoldRatio"
              />
            </div>
            <!-- Where the captured page stops: whatever of the pane is left
                 below is not page, and must not read as a blank part of it. -->
            <p
              v-if="filled"
              class="mx-auto flex items-center justify-center gap-1.5 border-t border-dashed border-accented py-2 text-[11px] text-dimmed"
              :style="{ width: `${surfaceWidth}px` }"
            >
              <UIcon name="i-ph-arrow-line-down" class="size-3.5" />
              {{ t('page.marketing.pages.preview.end_of_page') }}
            </p>
          </div>

          <!-- Outside the scrollport on purpose: inside, it is laid out at the
               top of the content and scrolls out of sight on a tall page. -->
          <div
            v-if="activeLoading"
            class="absolute inset-0 flex items-center justify-center rounded-lg bg-default/60"
          >
            <UIcon
              name="i-ph-circle-notch"
              class="size-6 animate-spin text-muted"
            />
          </div>
        </div>

        <!-- One empty state for every reason, in a plain wrapper: see `surface`. -->
        <div v-else>
          <DmsEmptyState
            :variant="surfaceEmpty.variant"
            :icon="surfaceEmpty.icon"
            :hatched="surface !== 'error'"
            :size="surface === 'error' ? 'sm' : undefined"
            :title="surfaceEmpty.title"
            :description="surfaceEmpty.description"
          >
            <template v-if="surface === 'error'" #actions>
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                icon="i-ph-arrow-clockwise"
                :label="t('page.marketing.common.retry')"
                @click="retryActive"
              />
            </template>
          </DmsEmptyState>
        </div>
      </div>

      <PagePreviewLegend
        :filled="filled"
        :overlay-mode="overlayMode"
        :most-clicked="mostClicked"
        :median-depth="medianDepth"
        :scroll-fold-ratio="scrollFoldRatio"
        :scroll-views="scrollViews"
        :used-in="usedIn"
      />
    </div>
  </section>
</template>
