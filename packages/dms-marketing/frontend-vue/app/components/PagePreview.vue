<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from '#dms/frontend-module'
import { useLatestRequest } from '../composables/useLatestRequest'
import {
  useMarketingApi,
  type MarketingHeatmap,
  type MarketingPageSnapshotResponse,
  type MarketingScrollDepth,
  type MarketingSnapshotLayout,
  type MarketingWebsite,
  type MarketingWebsitePatch,
} from '../composables/useMarketingApi'
import {
  useSnapshotFrame,
  type AnchorBox,
  type AnchorRequest,
} from '../composables/useSnapshotFrame'
import { rewriteViewportUnits } from '../utils/snapshotViewportUnits'

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
const props = defineProps<{
  website: MarketingWebsite | null
  path: string
  period: string
  /** Share of visits capturing clicks — why a quiet page looks empty. */
  sampleRate: number
  trackerEnabled: boolean
  /** Pageviews of this path over the window, for the sampling hint. */
  pageviews?: number
  /** Bumped by the parent when it resets clicks out from under this view. */
  refreshToken?: number
}>()

/** The site's snapshot options were changed here; the parent owns the row. */
const emit = defineEmits<{ 'website-updated': [] }>()

interface LayoutPreset {
  width: number
  layout: MarketingSnapshotLayout
  icon: string
  labelKey: string
}

/**
 * Layouts offered for inspection; a mobile layout is a different page. The
 * tablet is upright on purpose: lying flat it is 1024+ wide, a width most
 * breakpoints already dress as desktop — the button would repeat 1280.
 */
const LAYOUT_PRESETS: LayoutPreset[] = [
  { width: 1280, layout: 'desktop', icon: 'i-ph-monitor', labelKey: 'page.marketing.pages.preview.layout_desktop' },
  { width: 768, layout: 'tablet', icon: 'i-ph-device-tablet', labelKey: 'page.marketing.pages.preview.layout_tablet' },
  { width: 390, layout: 'phone', icon: 'i-ph-device-mobile', labelKey: 'page.marketing.pages.preview.layout_phone' },
]
const DEFAULT_LAYOUT_WIDTH = 1280
/** Viewport the snapshot is measured through when it recorded none. */
const PROBE_VIEWPORT_HEIGHT = 900
/** Height of the scrollable pane the scaled surface lives in. */
const PANE_HEIGHT = 620
/** Overflow beyond the chosen layout width worth telling the operator about. */
const OVERFLOW_TOLERANCE = 1.05
const SNAPSHOT_BYTE_CAP = 1024 * 1024
const LIGHT_CANVAS = '#ffffff'
const DARK_CANVAS = '#111111'

const api = useMarketingApi()
const { t, locale } = useI18n()

// --- Heatmap ----------------------------------------------------------------

// Path, site and period all retrigger a load and the answers can land out of
// order: a slow answer for the page the user just left would otherwise repaint
// over the one on screen — see useLatestRequest.
const {
  data: heatmap,
  loading,
  failed,
  run: loadHeatmap,
} = useLatestRequest<MarketingHeatmap>(() =>
  props.website && props.path && !import.meta.env.SSR
    ? api.getHeatmap(props.website._id, props.path, props.period)
    : null,
)

watch(
  () => [props.website?._id, props.path, props.period, props.refreshToken],
  () => void loadHeatmap(),
  { immediate: true },
)

const points = computed(() => heatmap.value?.points ?? [])
const maxWeight = computed(() => heatmap.value?.maxWeight ?? 0)
const totalClicks = computed(() => heatmap.value?.totalClicks ?? 0)

// --- Scroll depth -----------------------------------------------------------

const overlayMode = ref<'clicks' | 'scroll'>('clicks')

const {
  data: scrollDepth,
  loading: loadingScroll,
  failed: scrollFailed,
  run: loadScrollDepth,
} = useLatestRequest<MarketingScrollDepth>(() =>
  props.website && props.path && !import.meta.env.SSR
    ? api.getScrollDepth(props.website._id, props.path, props.period)
    : null,
)

/**
 * Lazy on purpose: nothing is fetched until the overlay is first opened,
 * then kept fresh against the same keys the click read watches. The key
 * comparison is what keeps a mere clicks↔scroll round trip from refetching.
 */
let scrollLoadedKey = ''

function ensureScrollDepth(): void {
  if (overlayMode.value !== 'scroll') {
    return
  }
  const key = [props.website?._id, props.path, props.period, props.refreshToken].join('|')
  if (key === scrollLoadedKey) {
    return
  }
  scrollLoadedKey = key
  void loadScrollDepth()
}

watch(
  () => [props.website?._id, props.path, props.period, props.refreshToken, overlayMode.value],
  ensureScrollDepth,
  { immediate: true },
)

const scrollViews = computed(() => scrollDepth.value?.views ?? 0)
const scrollReached = computed(() => scrollDepth.value?.reached ?? [])

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

// --- Reset ------------------------------------------------------------------

const { confirm } = useConfirm()
const toast = useToast()
const resetting = ref(false)

/** Deletes the clicks, scrolls and snapshots of the page (every period),
 *  then refetches the proof for whichever overlay is showing. */
async function resetPageHeatmap() {
  const website = props.website
  if (!website) {
    return
  }
  const confirmed = await confirm({
    title: t('page.marketing.pages.reset.page_title'),
    description: t('page.marketing.pages.reset.page_description', { path: props.path }),
    confirmLabel: t('page.marketing.pages.reset.confirm'),
    confirmColor: 'error',
  })
  if (!confirmed) {
    return
  }
  resetting.value = true
  try {
    const { deleted } = await api.resetHeatmap(website._id, props.path)
    toast.add({
      color: 'success',
      title: t('page.marketing.pages.reset.done', { count: deleted }, deleted),
    })
    scrollLoadedKey = ''
    ensureScrollDepth()
    await Promise.all([loadHeatmap(), loadSnapshot()])
  }
  catch {
    toast.add({ color: 'error', title: t('page.marketing.pages.reset.error') })
  }
  finally {
    resetting.value = false
  }
}

// --- Snapshot ---------------------------------------------------------------

const layoutWidth = ref(DEFAULT_LAYOUT_WIDTH)

const layout = computed<MarketingSnapshotLayout>(
  () => LAYOUT_PRESETS.find(preset => preset.width === layoutWidth.value)?.layout ?? 'desktop',
)

const snapshotsEnabled = computed(() => props.website?.snapshotsEnabled ?? false)

// Not fetched while the site has snapshots off: the option's banner is the
// whole story then, and a leftover capture must not contradict it.
const {
  data: snapshotResponse,
  settled: snapshotSettled,
  run: loadSnapshot,
} = useLatestRequest<MarketingPageSnapshotResponse>(() =>
  props.website && snapshotsEnabled.value && props.path && !import.meta.env.SSR
    ? api.getSnapshot(props.website._id, props.path, layout.value)
    : null,
)

watch(
  () => [props.website?._id, snapshotsEnabled.value, props.path, layout.value, props.refreshToken],
  () => void loadSnapshot(),
  { immediate: true },
)

const snapshot = computed(() => snapshotResponse.value?.snapshot ?? null)

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
  () => snapshotsEnabled.value && snapshotSettled.value && snapshot.value === null,
)
const tooHeavy = computed(() => snapshot.value !== null && backdrop.value === null)
const snapshotScheme = computed(() => snapshot.value?.colorScheme ?? 'light')
const capturedAtLabel = computed(() => {
  if (!snapshot.value) {
    return ''
  }
  const date = new Date(snapshot.value.capturedAt).toLocaleString(locale.value)
  return t(
    tooHeavy.value
      ? 'page.marketing.pages.preview.attempted_at'
      : 'page.marketing.pages.preview.captured_at',
    { date },
  )
})

function mebibytes(bytes: number): string {
  return new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(
    bytes / (1024 * 1024),
  )
}

const savingOptions = ref(false)

async function updateSnapshotOptions(patch: MarketingWebsitePatch): Promise<void> {
  const website = props.website
  if (!website) {
    return
  }
  savingOptions.value = true
  try {
    await api.updateWebsite(website._id, patch)
    emit('website-updated')
  }
  catch {
    toast.add({ color: 'error', title: t('page.marketing.pages.preview.options_error') })
  }
  finally {
    savingOptions.value = false
  }
}

// --- Frame geometry ---------------------------------------------------------

/** Free text: an empty field must stay empty, not refill with the applied value. */
const heightField = ref('')

const heightOverride = computed(() => {
  const typed = Number.parseInt(heightField.value, 10)
  return Number.isFinite(typed) && typed > 0 ? typed : null
})

const frame = ref<HTMLIFrameElement | null>(null)
const {
  measuredWidth,
  measuredHeight,
  tier,
  close: closeFrame,
  measureAnchors,
} = useSnapshotFrame(frame)

// Typing a height resizes the frame by hand, so the next reading would
// measure that — stop reading rather than latch it.
watch(heightOverride, (value) => {
  if (value !== null && tier.value === 'pending') {
    closeFrame()
  }
})

// A different width is a different rendering of the snapshot: the frame
// remounts on the key change, and the composable re-arms on the new one.
watch(layoutWidth, () => {
  heightField.value = ''
})

// A typed height belongs to the page it was typed on.
watch(() => [props.website?._id, props.path], () => {
  heightField.value = ''
})

const frameKey = computed(() =>
  [props.path, snapshot.value?.layout, snapshot.value?.capturedAt, layoutWidth.value].join('|'),
)

/** Viewport the frame is pinned to until its size is read. */
const probeHeight = computed(() => snapshot.value?.viewport.height ?? PROBE_VIEWPORT_HEIGHT)

/**
 * Height of the drawn surface — the overlay's coordinate space. Falls back to
 * a typical long page while the real one is unknown, so the heatmap is
 * readable before (and without) any snapshot.
 */
const renderHeight = computed(() => {
  const chosen = heightOverride.value ?? measuredHeight.value
  if (chosen !== null) {
    return Math.min(Math.max(chosen, MIN_RENDER_HEIGHT), MAX_RENDER_HEIGHT)
  }
  return DEFAULT_RENDER_HEIGHT
})

/**
 * Height of the frame itself. Pinned to the probe viewport while a reading
 * is still possible — resizing it earlier would corrupt the very number
 * being waited on. An operator override takes it back by hand.
 */
const frameHeight = computed(() => {
  if (heightOverride.value !== null) {
    return renderHeight.value
  }
  if (measuredHeight.value !== null) {
    return measuredHeight.value
  }
  return tier.value === 'pending' ? probeHeight.value : renderHeight.value
})

/**
 * Width the overlay maps onto. Clicks are normalized against the document's
 * `scrollWidth`, so a document wider than the frame must widen the canvas or
 * every x is compressed — while the frame itself stays at the chosen layout
 * width, which is what keeps the width buttons meaningful. The overflowing
 * part is clipped by the pane, exactly as it is clipped inside the frame.
 */
const overlayWidth = computed(() =>
  Math.min(Math.max(measuredWidth.value ?? 0, layoutWidth.value), MAX_RENDER_WIDTH),
)

// --- Element anchoring ------------------------------------------------------

/**
 * A click is stored twice: as a document fraction, and as an offset inside
 * the element it hit. Only the second survives being read back at another
 * size — a document fraction divides by a box that, on a page shorter than
 * the visitor's window, IS that window, so the same button arrives here as a
 * different fraction per visitor. Given the element's box in the layout on
 * screen, the offset puts the point back where the visitor put it.
 *
 * The boxes come from the snapshot document. Every way that can fail — no
 * snapshot, an element that no longer exists, a selector that became
 * ambiguous — resolves to no box, and a point with no box keeps its document
 * fraction, never a blank one.
 */
const anchorBoxes = ref(new Map<string, AnchorBox>())

function anchorKey(anchor: AnchorRequest): string {
  return `${anchor.selector}\0${anchor.nth}`
}

const requestedAnchors = computed(() => {
  const unique = new Map<string, AnchorRequest>()
  for (const point of points.value) {
    if (!point.anchor) {
      continue
    }
    const request = { selector: point.anchor.selector, nth: point.anchor.nth }
    unique.set(anchorKey(request), request)
  }
  return [...unique.values()]
})

/** Points in the overlay's coordinate space, anchored where one resolved. */
const drawnPoints = computed(() =>
  points.value.map((point) => {
    const anchor = point.anchor
    if (!anchor) {
      return point
    }
    const box = anchorBoxes.value.get(anchorKey(anchor))
    if (!box || overlayWidth.value <= 0 || renderHeight.value <= 0) {
      return point
    }
    return {
      ...point,
      x: (box.x + anchor.ox * box.width) / overlayWidth.value,
      y: (box.y + anchor.oy * box.height) / renderHeight.value,
    }
  }),
)

let measureToken = 0

/**
 * Re-measure whenever the layout the boxes were taken in changes. The token
 * drops a pass for a geometry that is no longer on screen: the frame is
 * resized from the published reading, and a box read before that resize has
 * been laid out measures the probe viewport.
 */
async function refreshAnchorBoxes(): Promise<void> {
  const token = ++measureToken
  if (tier.value !== 'measured' || requestedAnchors.value.length === 0) {
    if (anchorBoxes.value.size > 0) {
      anchorBoxes.value = new Map()
    }
    return
  }
  await nextTick()
  await new Promise(resolve => requestAnimationFrame(resolve))
  if (token !== measureToken) {
    return
  }
  const resolved = new Map<string, AnchorBox>()
  for (const box of measureAnchors(requestedAnchors.value)) {
    resolved.set(anchorKey(box), box)
  }
  anchorBoxes.value = resolved
}

watch(
  [requestedAnchors, tier, renderHeight, overlayWidth],
  () => void refreshAnchorBoxes(),
)

/**
 * The document does not fit the surface the canvas can allocate. Both are
 * clamped, so the overlay is uniformly compressed against a backdrop that
 * is merely cut off — the two no longer line up, and that is worth saying
 * rather than showing.
 */
const oversized = computed(
  () =>
    (measuredHeight.value ?? 0) > MAX_RENDER_HEIGHT
    || (measuredWidth.value ?? 0) > MAX_RENDER_WIDTH,
)

const overflowing = computed(
  () => (measuredWidth.value ?? 0) > layoutWidth.value * OVERFLOW_TOLERANCE,
)

// The surface is laid out at `layoutWidth` and zoomed down to the pane, so the
// overlay and the page share one coordinate space at any container size.
// `zoom`, not `transform: scale()`: a transformed frame is rasterized at its
// natural size and resampled, and at a fractional scale the thin borders of
// inputs and cards drop out; zoom reaches the frame's document as a page
// zoom, laid out at the same CSS width and painted crisp at the scale. The
// pane always reserves its scrollbar (`overflow-y-scroll`): letting it appear
// and disappear would change the width the scale is derived from, which
// changes the height, which decides whether the scrollbar is there at all.
const container = ref<HTMLElement | null>(null)
const containerWidth = ref(0)
let observer: ResizeObserver | null = null

watch(container, (el) => {
  observer?.disconnect()
  observer = null
  if (!el) {
    return
  }
  containerWidth.value = el.clientWidth
  observer = new ResizeObserver(() => {
    containerWidth.value = el.clientWidth
  })
  observer.observe(el)
})

onBeforeUnmount(() => observer?.disconnect())

const scale = computed(() =>
  containerWidth.value > 0 ? containerWidth.value / layoutWidth.value : 1,
)

/** Height of the zoomed surface in the pane's own pixels — the scroll range
 *  of the pane and the space the scroll-depth overlay draws in. */
const scrolledHeight = computed(() => Math.round(renderHeight.value * scale.value))

// --- Emptiness, explained ---------------------------------------------------

/**
 * Page loads whose clicks were captured at all. Sampling is drawn once per
 * page load (tracker.js), so this bounds whether a heatmap could exist — it
 * is not a click estimate, and must not be shown as one next to the real
 * count.
 */
const expectedSampledPageLoads = computed(() =>
  props.pageviews ? Math.round(props.pageviews * props.sampleRate) : null,
)

/** Silence has shared causes (collection off, sampled out) before the
 *  per-overlay one; both overlays explain themselves through this. */
function captureEmptyReason(fallbackKey: string): string {
  if (!props.trackerEnabled) {
    return t('page.marketing.pages.empty.tracking_off')
  }
  if (expectedSampledPageLoads.value !== null && expectedSampledPageLoads.value < 1) {
    return t('page.marketing.pages.empty.sampled_out', {
      rate: Math.round(props.sampleRate * 100),
    })
  }
  return t(fallbackKey)
}

const emptyState = computed(() => {
  if (overlayMode.value === 'clicks') {
    if (loading.value || heatmap.value === null || totalClicks.value > 0) {
      return null
    }
    return {
      title: t('page.marketing.pages.empty.title'),
      description: captureEmptyReason('page.marketing.pages.empty.no_clicks'),
    }
  }
  if (loadingScroll.value || scrollDepth.value === null || scrollViews.value > 0) {
    return null
  }
  return {
    title: t('page.marketing.pages.empty.scroll_title'),
    description: captureEmptyReason('page.marketing.pages.empty.no_scrolls'),
  }
})

// --- Per-overlay surface state ----------------------------------------------

const activeFailed = computed(() =>
  overlayMode.value === 'clicks' ? failed.value : scrollFailed.value,
)

const activeLoading = computed(() =>
  overlayMode.value === 'clicks' ? loading.value : loadingScroll.value,
)

function retryActive(): void {
  if (overlayMode.value === 'clicks') {
    void loadHeatmap()
    return
  }
  void loadScrollDepth()
}

const truncatedState = computed(() => {
  if (overlayMode.value === 'clicks' && heatmap.value?.truncated) {
    return {
      title: t('page.marketing.pages.truncated'),
      description: t('page.marketing.pages.truncated_hint'),
    }
  }
  if (overlayMode.value === 'scroll' && scrollDepth.value?.truncated) {
    return {
      title: t('page.marketing.pages.scroll.truncated'),
      description: t('page.marketing.pages.scroll.truncated_hint'),
    }
  }
  return null
})

/** The real page, on the origin the snapshot was captured from — opened,
 *  never framed. */
const externalUrl = computed(() => {
  if (!snapshot.value || !props.path) {
    return ''
  }
  try {
    return new URL(props.path, snapshot.value.origin).toString()
  }
  catch {
    return ''
  }
})
</script>

<template>
  <div class="flex flex-col gap-4 p-4">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <p class="truncate font-mono text-sm text-highlighted">{{ props.path }}</p>
        <p class="text-xs text-muted">
          <template v-if="overlayMode === 'clicks'">
            {{ t('page.marketing.pages.clicks', { count: totalClicks }, totalClicks) }}
          </template>
          <template v-else>
            {{ t('page.marketing.pages.scroll.views', { count: scrollViews }, scrollViews) }}
          </template>
          <span v-if="props.pageviews">
            · {{ t('page.marketing.pages.pageviews', { count: props.pageviews }, props.pageviews) }}
          </span>
          <span v-if="capturedAtLabel">
            · {{ capturedAtLabel }}
          </span>
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UFieldGroup size="sm">
          <UButton
            icon="i-ph-cursor-click"
            :color="overlayMode === 'clicks' ? 'primary' : 'neutral'"
            variant="subtle"
            :label="t('page.marketing.pages.overlay.clicks')"
            @click="overlayMode = 'clicks'"
          />
          <UButton
            icon="i-ph-caret-double-down"
            :color="overlayMode === 'scroll' ? 'primary' : 'neutral'"
            variant="subtle"
            :label="t('page.marketing.pages.overlay.scroll')"
            @click="overlayMode = 'scroll'"
          />
        </UFieldGroup>
        <UFieldGroup size="sm">
          <UButton
            v-for="preset in LAYOUT_PRESETS"
            :key="preset.width"
            :icon="preset.icon"
            :color="layoutWidth === preset.width ? 'primary' : 'neutral'"
            variant="subtle"
            :title="`${t(preset.labelKey)} · ${preset.width}px`"
            :aria-label="`${t(preset.labelKey)} · ${preset.width}px`"
            :ui="{ leadingIcon: 'size-5' }"
            @click="layoutWidth = preset.width"
          />
        </UFieldGroup>
        <UInput
          v-model="heightField"
          type="number"
          :min="MIN_RENDER_HEIGHT"
          :placeholder="`${renderHeight}`"
          step="200"
          size="xs"
          class="w-24"
          :title="t('page.marketing.pages.preview.height_override')"
        />
        <UButton
          v-if="externalUrl"
          icon="i-ph-arrow-square-out"
          :to="externalUrl"
          target="_blank"
          color="neutral"
          variant="ghost"
          size="xs"
          :label="t('page.marketing.pages.preview.open_in_tab')"
        />
        <UPopover v-if="props.website">
          <UButton
            icon="i-ph-camera"
            color="neutral"
            variant="ghost"
            size="xs"
            :loading="savingOptions"
            :title="t('page.marketing.pages.preview.options')"
            :aria-label="t('page.marketing.pages.preview.options')"
          />
          <template #content>
            <div class="flex w-80 flex-col gap-4 p-4">
              <USwitch
                :model-value="snapshotsEnabled"
                :disabled="savingOptions"
                :label="t('page.marketing.pages.preview.snapshots_enabled')"
                :description="t('page.marketing.pages.preview.snapshots_enabled_hint')"
                @update:model-value="(value: boolean) => updateSnapshotOptions({ snapshotsEnabled: value })"
              />
              <USwitch
                :model-value="props.website.snapshotMaskText === true"
                :disabled="savingOptions || !snapshotsEnabled"
                :label="t('page.marketing.pages.preview.mask_text')"
                :description="t('page.marketing.pages.preview.mask_text_hint')"
                @update:model-value="(value: boolean) => updateSnapshotOptions({ snapshotMaskText: value })"
              />
            </div>
          </template>
        </UPopover>
        <UButton
          icon="i-ph-eraser"
          color="error"
          variant="ghost"
          size="xs"
          :loading="resetting"
          :title="t('page.marketing.pages.reset.page_button')"
          @click="resetPageHeatmap"
        />
      </div>
    </div>

    <!-- Backdrop-state banners. None of these affect the numbers below. -->
    <UAlert
      v-if="!snapshotsEnabled"
      icon="i-ph-camera-slash"
      color="neutral"
      variant="subtle"
      :title="t('page.marketing.pages.preview.snapshots_off')"
      :description="t('page.marketing.pages.preview.snapshots_off_hint')"
      :actions="[{
        label: t('page.marketing.pages.preview.enable_snapshots'),
        color: 'neutral',
        variant: 'subtle',
        loading: savingOptions,
        onClick: () => updateSnapshotOptions({ snapshotsEnabled: true }),
      }]"
    />

    <UAlert
      v-else-if="noSnapshotYet"
      icon="i-ph-camera"
      color="neutral"
      variant="subtle"
      :title="t('page.marketing.pages.preview.no_snapshot')"
      :description="t('page.marketing.pages.preview.no_snapshot_hint', { rate: Math.round(props.sampleRate * 100) })"
    />

    <UAlert
      v-else-if="snapshot && tooHeavy"
      icon="i-ph-file-x"
      color="warning"
      variant="subtle"
      :title="t('page.marketing.pages.preview.too_heavy')"
      :description="t('page.marketing.pages.preview.too_heavy_hint', {
        size: mebibytes(snapshot.bytes),
        limit: mebibytes(SNAPSHOT_BYTE_CAP),
      })"
    />

    <UAlert
      v-else-if="snapshot && !snapshot.exact"
      icon="i-ph-arrows-out-line-horizontal"
      color="neutral"
      variant="subtle"
      :title="t('page.marketing.pages.preview.approximate_layout')"
      :description="t('page.marketing.pages.preview.approximate_layout_hint', {
        layout: t(`page.marketing.pages.preview.layout_${snapshot.layout}`).toLowerCase(),
      })"
    />

    <!-- Geometry banners stand on their own: a reflowed layout can overflow
         too, and the second fact must not hide behind the first. -->
    <UAlert
      v-if="oversized"
      icon="i-ph-arrows-out-line-vertical"
      color="warning"
      variant="subtle"
      :title="t('page.marketing.pages.preview.oversized')"
      :description="t('page.marketing.pages.preview.oversized_hint')"
    />

    <UAlert
      v-else-if="overflowing"
      icon="i-ph-arrows-horizontal"
      color="neutral"
      variant="subtle"
      :title="t('page.marketing.pages.preview.overflow')"
      :description="t('page.marketing.pages.preview.overflow_hint', { width: measuredWidth })"
    />

    <UAlert
      v-if="truncatedState"
      icon="i-ph-warning"
      color="warning"
      variant="subtle"
      :title="truncatedState.title"
      :description="truncatedState.description"
    />

    <UAlert
      v-if="emptyState"
      :icon="overlayMode === 'clicks' ? 'i-ph-cursor-click' : 'i-ph-caret-double-down'"
      :title="emptyState.title"
      :description="emptyState.description"
    />

    <!-- Surface: only over a snapshot. While the snapshot is being fetched
         the space is reserved, so a page that has one does not jump. -->
    <div v-if="activeFailed" class="flex flex-col items-start gap-3">
      <p class="text-sm text-error">{{ t('page.marketing.pages.error') }}</p>
      <UButton
        icon="i-ph-arrow-clockwise"
        :label="t('page.marketing.pages.retry')"
        color="neutral"
        variant="subtle"
        size="sm"
        @click="retryActive"
      />
    </div>

    <USkeleton
      v-else-if="snapshotsEnabled && !snapshotSettled"
      class="w-full rounded-lg"
      :style="{ height: `${PANE_HEIGHT}px` }"
    />

    <!-- Kept mounted across refetches: tearing it down would re-render the
         snapshot — and re-measure it — on every period change. -->
    <div v-else-if="snapshot && backdrop !== null" class="relative">
      <div
        ref="container"
        class="overflow-y-scroll overflow-x-hidden rounded-lg border border-default bg-elevated"
        :style="{ height: `${PANE_HEIGHT}px` }"
      >
        <div class="relative" :style="{ height: `${scrolledHeight}px` }">
          <div
            class="absolute left-0 top-0"
            :style="{
              width: `${layoutWidth}px`,
              height: `${renderHeight}px`,
              zoom: scale,
            }"
          >
            <!-- Inert on purpose: pointer-events none means no link, form or
                 hover state inside the snapshot can fire, and the wheel
                 scrolls the pane instead of dying in the frame. The sandbox
                 allows same-origin and nothing else — no script, no form,
                 no navigation — which is what lets useSnapshotFrame read the
                 document directly while a capture that arrived through a
                 public endpoint stays inert. `color-scheme` and the canvas
                 color follow the visitor's mode at capture: the page's
                 media queries resolve the way they did for them, and a page
                 with no background of its own stays on the canvas it had. -->
            <iframe
              :key="frameKey"
              ref="frame"
              :srcdoc="frameDocument"
              class="pointer-events-none absolute left-0 top-0 w-full border-0"
              :style="{
                height: `${frameHeight}px`,
                colorScheme: snapshotScheme,
                backgroundColor: snapshotScheme === 'dark' ? DARK_CANVAS : LIGHT_CANVAS,
              }"
              sandbox="allow-same-origin"
              scrolling="no"
              referrerpolicy="no-referrer"
              :title="props.path"
            />
            <DmsMarketingHeatmapCanvas
              v-if="overlayMode === 'clicks'"
              :points="drawnPoints"
              :max-weight="maxWeight"
              :width="overlayWidth"
              :height="renderHeight"
            />
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

      </div>

      <!-- Outside the scrollport on purpose: inside, it is laid out at the top
           of the content and scrolls out of sight on a tall page. -->
      <div
        v-if="activeLoading"
        class="absolute inset-0 flex items-center justify-center rounded-lg bg-default/60"
      >
        <UIcon name="i-ph-circle-notch" class="size-6 animate-spin text-muted" />
      </div>
    </div>
  </div>
</template>
