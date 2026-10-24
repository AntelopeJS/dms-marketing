<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useDmsRoute, useDmsRouter, useI18n } from '#dms/frontend-module'
// Imported rather than resolved from the registry: a registered component is
// a lazy chunk of its own, fetched only once a page is selected, so the
// preview would land a beat after the list, its column empty meanwhile.
import DmsMarketingPagePreview from './PagePreview.vue'
import type {
  MarketingPageEntry,
  MarketingPages,
  MarketingPagesSort,
  MarketingWebsite,
} from '../composables/useMarketingApi'
import {
  useDashboardWorkspaces,
  usePageInventory,
  useWebsiteFunnels,
  useWebsites,
} from '../composables/useMarketingReads'
import { useMarketingContext } from '../composables/useMarketingContext'
import { installLink } from '../composables/useMarketingRoutes'
import { PERIOD_SCOPE } from '../constants'
import { parseFunnelStepsValue } from '../composables/useFunnelSteps'
import { formatNumber } from '../utils/format'
import { pageSnapshotBadge } from '../utils/page-snapshot'
import { measureFillHeight } from '../utils/fill-height'
import { useMarketingNow } from '../composables/useMarketingNow'
import { normalizePagePath, selectedPageRow } from '../utils/heatmap'
import {
  effectiveWorkspace,
  rememberedWorkspace,
  rememberWorkspace,
  WORKSPACE_QUERY,
} from '../utils/workspace-scope'

/**
 * Pages & heatmaps: the paths visitors loaded on the selected website, with
 * the clicks and scroll depth of the selected one over its snapshot.
 *
 * Keyed on nothing but a website id and a pathname the tracker reported — no
 * route registry, no sitemap — which is what makes it hold for any site. The
 * filter is also a path field: a day keeps a capped number of paths, so a page
 * can be missing from the list while its clicks are perfectly queryable.
 */
const props = withDefaults(
  defineProps<{
    periodScope?: string
    componentId?: string
    pageId?: string
  }>(),
  { periodScope: PERIOD_SCOPE, componentId: undefined, pageId: undefined },
)

const SEARCH_DEBOUNCE_MS = 300
/** The snapshot ages of the rows move on by the minute. */
const NOW_TICK_MS = 60_000
const SKELETON_ROWS = 8
/** Where the list and the preview sit side by side (Tailwind `xl`). */
const SIDE_BY_SIDE_QUERY = '(min-width: 1280px)'

const { t, locale } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const context = useMarketingContext()

const websiteId = computed(() => context.selected.value?.id ?? '')
const period = usePeriodScope(props.periodScope)
/** The days read: a comparison change alone reads nothing again. */
const pagesPeriod = computed(() =>
  period.value
    ? {
        ...period.value,
        comparison: 'none' as const,
        compareRange: null,
      }
    : null,
)

const queryPath = () =>
  typeof route.query.path === 'string' ? route.query.path : ''
const selectedPath = ref<string | undefined>(queryPath() || undefined)
const search = ref('')
/** The search the list is read with, once the box holds still. */
const searchedTerm = ref('')
const sort = ref<MarketingPagesSort>('views')

// The full row: the context carries the id, the preview needs the snapshot options.
const websitesRead = useWebsites()
const website = computed(
  () =>
    websitesRead.data.value?.find((site) => site._id === websiteId.value) ??
    null,
)

/**
 * A site as its update answered it, in place: the sites are not read again.
 * The pages are, when its snapshot options changed — saving them deleted the
 * site's snapshots, which the rows show.
 */
function putWebsite(saved: MarketingWebsite): void {
  const sites = websitesRead.data.value
  const previous = sites?.find((site) => site._id === saved._id)
  if (sites) {
    websitesRead.data.value = sites.map((site) =>
      site._id === saved._id ? saved : site,
    )
  }
  if (
    previous &&
    (previous.snapshotsEnabled !== saved.snapshotsEnabled ||
      previous.snapshotMaskText !== saved.snapshotMaskText)
  ) {
    void loadPages()
  }
}

// --- Workspace scope ----------------------------------------------------------

// A platform owner on the dashboard's own website reads it for another
// workspace, or all of them (see utils/workspace-scope). Everyone else gets
// an empty list from the backend, which also refuses the scope itself.
const workspacesRead = useDashboardWorkspaces(websiteId)
const workspaceOptions = computed(() =>
  workspacesRead.error.value
    ? []
    : (workspacesRead.data.value?.workspaces ?? []),
)
const queryWorkspace = () => {
  const value = route.query[WORKSPACE_QUERY]
  return typeof value === 'string' ? value : ''
}
/** What the link asks for, else this browser's last pick (once mounted:
 * the storage is the browser's). */
const wantedWorkspace = ref(queryWorkspace())
/** The scope the reads use: the own workspace until the selector offers
 * the wanted one. */
const workspace = computed(() =>
  effectiveWorkspace(wantedWorkspace.value, workspaceOptions.value),
)
/** Another workspace's data: read-only, backdrops masked by the backend. */
const foreign = computed(() => workspace.value !== '')
/** A wanted scope waits for the selector's answer, so a link to one never
 * reads the own workspace first, nor fails for a viewer it is not for. */
const scopeReady = computed(
  () =>
    !wantedWorkspace.value ||
    workspacesRead.status.value === 'success' ||
    workspacesRead.status.value === 'error',
)
const scopedWebsiteId = computed(() =>
  scopeReady.value ? websiteId.value : '',
)

function selectWorkspace(value: string): void {
  wantedWorkspace.value = value
  rememberWorkspace(value)
  void router.replace({
    query: { ...route.query, [WORKSPACE_QUERY]: value || undefined },
  })
}

// Back and Forward move the scope with the URL.
watch(queryWorkspace, (value) => {
  wantedWorkspace.value = value || rememberedWorkspace()
})

// A remembered scope lands in the URL too: a copied link carries it.
watch(workspace, (value) => {
  if (value && queryWorkspace() !== value) {
    void router.replace({ query: { ...route.query, [WORKSPACE_QUERY]: value } })
  }
})

const inventoryRead = usePageInventory({
  websiteId: scopedWebsiteId,
  period: pagesPeriod,
  search: searchedTerm,
  sort,
  workspace,
})
const inventory = computed(() =>
  inventoryRead.error.value ? null : inventoryRead.data.value,
)

// The pages panel holds the workspace selector from the first paint: a
// server render, or a navigation, reads the workspaces before it draws, so
// the panel never grows under the reader (the inventory reads alongside).
await workspacesRead

const loading = computed(() => inventoryRead.status.value === 'pending')
/** A list is on screen (the previous one while another loads), or failed. */
const settled = computed(
  () =>
    inventoryRead.data.value !== null ||
    inventoryRead.status.value === 'success' ||
    inventoryRead.status.value === 'error',
)
const failed = computed(
  () => !!inventoryRead.error.value && inventoryRead.status.value !== 'pending',
)
const loadPages = (): Promise<void> => inventoryRead.refresh()

const funnelsRead = useWebsiteFunnels(websiteId)
const funnels = computed(() =>
  funnelsRead.error.value ? [] : (funnelsRead.data.value ?? []),
)

watch(websiteId, () => {
  selectedPath.value = undefined
})

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (value) => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
  searchTimer = setTimeout(
    () => (searchedTerm.value = value.trim()),
    SEARCH_DEBOUNCE_MS,
  )
})
onBeforeUnmount(() => searchTimer && clearTimeout(searchTimer))

const pages = computed(() => inventory.value?.pages ?? [])
const sampleRate = computed(() => inventory.value?.sampleRate ?? null)
/** The measured sampling share as a sentence writes it: "10%", "0.4%". */
const sampleRateLabel = computed(() => {
  const rate = sampleRate.value
  return rate === null
    ? null
    : String(
        formatPercentage(rate, locale.value, {
          maximumFractionDigits: rate > 0 && rate < 0.01 ? 1 : 0,
        }),
      )
})
const trackerEnabled = computed(() => inventory.value?.trackerEnabled ?? true)
const waiting = computed(() => context.selected.value?.state === 'waiting')

const now = useMarketingNow(NOW_TICK_MS)

/** The listed pages, each with what its row says of its snapshot. */
const rows = computed(() =>
  pages.value.map((page) => ({
    ...page,
    badge: pageSnapshotBadge(page.snapshot, now.value, t, locale.value),
  })),
)

function metricOf(page: { pageviews: number; clicks: number }): number {
  return sort.value === 'clicks' ? page.clicks : page.pageviews
}

const maxMetric = computed(() => Math.max(1, ...pages.value.map(metricOf)))

/**
 * A pick in the list is a navigation the Back button undoes; a selection
 * made for the reader (first load, website switch) only completes the URL.
 * Keeps the rest of the query: the context bar mirrors its own state there.
 */
function selectPath(path: string | undefined, mode: 'push' | 'replace'): void {
  selectedPath.value = path
  void router[mode]({ query: { ...route.query, path: path ?? undefined } })
}

/** Back and Forward move the selection with the URL. */
watch(queryPath, (path) => {
  if (path && path !== selectedPath.value) {
    selectedPath.value = path
  }
})

// A first impression that shows the feature: the first page with clicks,
// else the first page. In the browser: the list a server render hands over
// is chosen from once mounted.
function selectFirst(data: MarketingPages | null): void {
  if (!selectedPath.value && data?.pages.length) {
    const withClicks = data.pages.find((page) => page.clicks > 0)
    selectPath((withClicks ?? data.pages[0])?.path, 'replace')
  }
}
watch(inventory, selectFirst)

const previewWrapper = ref<HTMLElement | null>(null)

/**
 * Side by side, the list and the preview fill the window below the context
 * bar, each scrolling inside itself: the page does not scroll, and the
 * preview's toolbar and legend stay in sight however long the page or the
 * list. Stacked (below xl), nothing is pinned: null.
 */
const panes = ref<HTMLElement | null>(null)
const paneHeight = ref<number | null>(null)
let paneFrame = 0

function measurePanes(): void {
  cancelAnimationFrame(paneFrame)
  paneFrame = requestAnimationFrame(() => {
    const element = panes.value
    paneHeight.value =
      element && window.matchMedia(SIDE_BY_SIDE_QUERY).matches
        ? measureFillHeight(element)
        : null
  })
}

// What sits above or below the panes (a banner, the sampling note) moves
// them: the body's size says so on a page that scrolls, this block's own on
// a shell that scrolls a panel. Their own height leaves the answer as is,
// so the observer settles at once.
let paneObserver: ResizeObserver | null = null
onMounted(() => {
  measurePanes()
  window.addEventListener('resize', measurePanes)
  paneObserver = new ResizeObserver(measurePanes)
  paneObserver.observe(document.body)
  const block = panes.value?.parentElement
  if (block) {
    paneObserver.observe(block)
  }
})
onBeforeUnmount(() => {
  cancelAnimationFrame(paneFrame)
  window.removeEventListener('resize', measurePanes)
  paneObserver?.disconnect()
})

// The panes come and go with the waiting state.
watch(panes, (element) => element && measurePanes())

const paneStyle = computed(() =>
  paneHeight.value === null ? undefined : { height: `${paneHeight.value}px` },
)

/** Stacked under the list (below xl), the preview is out of sight: bring it in. */
async function pick(path: string): Promise<void> {
  selectPath(path, 'push')
  if (window.matchMedia(SIDE_BY_SIDE_QUERY).matches) {
    return
  }
  await nextTick()
  previewWrapper.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const typedPath = computed(() => normalizePagePath(search.value))

/** Enter inspects what was typed, listed or not, reduced like a tracked URL. */
function inspectTyped(): void {
  if (typedPath.value) {
    void pick(typedPath.value)
  }
}

/**
 * The selected path's row, kept while a filter hides it from the list: the
 * preview header keeps its views.
 */
const selectedPage = ref<MarketingPageEntry>()
watch([pages, selectedPath], ([list, path]) => {
  selectedPage.value = selectedPageRow(list, path, selectedPage.value)
})

/** What the list is read for, the filter aside: a change is another read. */
const readScope = computed(() =>
  JSON.stringify([workspace.value, pagesPeriod.value]),
)
// Another workspace or other days: the row read before says nothing of
// them, the header waits for the path's row in the new list (or none).
watch(readScope, () => {
  selectedPage.value = undefined
})

/** Funnels with a page step on the selected path, for the "Used in" card. */
const usedIn = computed(() =>
  funnels.value.filter((funnel) =>
    parseFunnelStepsValue(funnel.steps).some(
      (step) => step.kind === 'url' && step.value === selectedPath.value,
    ),
  ),
)

// The preview draws in the browser only (frames, canvases): a server render
// holds its place, until the browser hydrating it is mounted. A client
// navigation draws it with the list, from the first render: mounted later,
// it would come in after the list, and its skeleton after none.
const mounted = ref(!import.meta.env.SSR && !isDmsHydrating())
if (mounted.value) {
  selectFirst(inventory.value)
}
onMounted(() => {
  mounted.value = true
  selectFirst(inventory.value)
  wantedWorkspace.value ||= rememberedWorkspace()
})

const countLabel = computed(() => {
  const listed = pages.value.length
  const total = inventory.value?.total ?? listed
  return total > listed
    ? t('page.marketing.pages.count_of', { count: listed, total }, total)
    : t('page.marketing.pages.count', { count: listed }, listed)
})

const sortItems = computed(() => [
  { value: 'views', label: t('page.marketing.pages.views') },
  { value: 'clicks', label: t('page.marketing.pages.overlay.clicks') },
])
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- The Pages page's context bar shows its own guide first; this one
         serves the block placed under a bar without it. -->
    <DmsEmptyState
      v-if="waiting"
      icon="i-ph-hourglass"
      class="dms-card"
      :title="
        t('page.marketing.pages.waiting.title', {
          website: context.selected.value?.name ?? '',
        })
      "
      :description="t('page.marketing.pages.waiting.description')"
    >
      <template #actions>
        <UButton
          size="sm"
          icon="i-ph-plugs-connected"
          :label="t('page.marketing.pages.waiting.action')"
          :to="installLink(websiteId)"
        />
      </template>
    </DmsEmptyState>

    <template v-else>
      <!-- The preview's own strip says it when a page is shown. -->
      <DmsBanner
        v-if="!trackerEnabled && !(selectedPath && website)"
        tone="error"
        size="sm"
        icon="i-ph-plugs"
        :title="t('page.marketing.pages.tracking_off.title')"
        :description="t('page.marketing.pages.tracking_off.description')"
      />

      <div
        ref="panes"
        class="grid items-start gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]"
      >
        <section
          class="dms-card flex min-w-0 flex-col overflow-hidden p-0"
          :class="paneHeight === null ? 'xl:sticky xl:top-4' : ''"
          :style="paneStyle"
        >
          <!-- Whose dashboard the list reads, above its search: read with
               the page, so the row is there from the first paint. -->
          <div
            v-if="workspaceOptions.length > 1"
            class="border-b border-default p-3"
          >
            <DmsMarketingWorkspaceScope
              :workspaces="workspaceOptions"
              :model-value="workspace"
              @update:model-value="selectWorkspace"
            />
          </div>
          <div class="flex items-center gap-2 border-b border-default p-3">
            <UInput
              v-model="search"
              size="sm"
              icon="i-ph-magnifying-glass"
              class="flex-1"
              :placeholder="t('page.marketing.pages.search_placeholder')"
              @keyup.enter="inspectTyped"
            />
          </div>
          <div class="flex items-center justify-between gap-2 px-4 py-2">
            <DmsEyebrow :label="countLabel" />
            <DmsSegmented
              v-model="sort"
              :items="sortItems"
              size="xs"
              :aria-label="t('page.marketing.pages.sort')"
            />
          </div>
          <DmsEmptyState
            v-if="failed"
            variant="error"
            size="sm"
            :title="t('page.marketing.common.load_error')"
          >
            <template #actions>
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                icon="i-ph-arrow-clockwise"
                :label="t('page.marketing.common.retry')"
                @click="loadPages"
              />
            </template>
          </DmsEmptyState>
          <ul
            v-else-if="!settled"
            class="flex flex-col gap-1 p-2"
            aria-hidden="true"
          >
            <li v-for="index in SKELETON_ROWS" :key="index" class="px-2 py-2">
              <USkeleton class="h-8 w-full" />
            </li>
          </ul>
          <DmsEmptyState
            v-else-if="pages.length === 0 && search.trim()"
            icon="i-ph-magnifying-glass"
            size="sm"
            :title="t('page.marketing.pages.no_match.title')"
            :description="t('page.marketing.pages.no_match.description')"
          >
            <template v-if="typedPath" #actions>
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                icon="i-ph-cursor-click"
                :label="
                  t('page.marketing.pages.no_match.inspect', {
                    path: typedPath,
                  })
                "
                @click="inspectTyped"
              />
            </template>
          </DmsEmptyState>
          <DmsEmptyState
            v-else-if="pages.length === 0"
            icon="i-ph-browser"
            size="sm"
            :title="
              t('page.marketing.pages.no_pages.title', {
                website: context.selected.value?.name ?? '',
              })
            "
            :description="t('page.marketing.pages.no_pages.description')"
          />
          <ul
            v-else
            class="flex flex-col gap-1 overflow-y-auto p-2"
            :class="[
              loading ? 'opacity-60' : '',
              paneHeight === null
                ? 'max-h-[45vh] xl:max-h-[70vh]'
                : 'min-h-0 flex-1',
            ]"
          >
            <li v-for="page in rows" :key="page.path">
              <button
                type="button"
                class="flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors"
                :class="
                  page.path === selectedPath
                    ? 'border-primary bg-primary/10'
                    : 'border-transparent hover:bg-elevated'
                "
                :title="page.path"
                :aria-current="page.path === selectedPath ? 'true' : undefined"
                @click="pick(page.path)"
              >
                <span class="flex items-center gap-2">
                  <span
                    class="min-w-0 flex-1 truncate font-mono text-[13px]"
                    :class="
                      page.path === selectedPath
                        ? 'font-medium text-highlighted'
                        : 'text-highlighted'
                    "
                  >
                    {{ page.path }}
                  </span>
                  <span class="font-mono text-xs tabular-nums text-highlighted">
                    {{ formatNumber(metricOf(page), locale) }}
                  </span>
                </span>
                <span class="flex items-center gap-2">
                  <span
                    class="flex flex-1 items-center gap-1 text-[11px]"
                    :class="
                      page.path === selectedPath ? 'text-muted' : 'text-dimmed'
                    "
                  >
                    <template v-if="sort === 'views'">
                      <UIcon name="i-ph-cursor-click" class="size-3" />
                      {{
                        t(
                          'page.marketing.pages.row_clicks',
                          { count: formatNumber(page.clicks, locale) },
                          page.clicks,
                        )
                      }}
                    </template>
                    <template v-else>
                      <UIcon name="i-ph-eye" class="size-3" />
                      {{
                        t(
                          'page.marketing.pages.row_views',
                          { count: formatNumber(page.pageviews, locale) },
                          page.pageviews,
                        )
                      }}
                    </template>
                  </span>
                  <span
                    v-if="page.badge"
                    class="flex shrink-0 items-center gap-1 text-[11px]"
                    :class="page.badge.muted ? 'text-dimmed' : 'text-muted'"
                    :title="page.badge.title"
                  >
                    <UIcon
                      :name="page.badge.icon"
                      class="size-3"
                      :class="page.badge.muted ? '' : 'text-success'"
                    />
                    <span class="sr-only">{{ page.badge.title }}</span>
                    <span aria-hidden="true">{{ page.badge.label }}</span>
                  </span>
                  <span
                    class="h-1 w-14 overflow-hidden rounded-full bg-elevated"
                    aria-hidden="true"
                  >
                    <span
                      class="block h-full rounded-full bg-primary"
                      :style="{
                        width: `${(metricOf(page) / maxMetric) * 100}%`,
                      }"
                    />
                  </span>
                </span>
              </button>
            </li>
          </ul>
          <footer
            class="flex items-center gap-1.5 border-t border-default px-4 py-2.5 text-xs text-dimmed"
          >
            <UIcon name="i-ph-info" class="size-3.5 shrink-0" />
            {{
              inventory?.truncated
                ? t('page.marketing.pages.list_truncated', {
                    count: pages.length,
                  })
                : t('page.marketing.pages.missing_hint')
            }}
          </footer>
        </section>

        <div
          v-if="(selectedPath && website) || (!mounted && pages.length > 0)"
          ref="previewWrapper"
          class="min-w-0 scroll-mt-4"
        >
          <USkeleton
            v-if="!mounted || !selectedPath || !website"
            class="h-[32rem] rounded-xl"
            :style="paneStyle"
            aria-hidden="true"
          />
          <DmsMarketingPagePreview
            v-else
            :website="website"
            :path="selectedPath"
            :period="period"
            :sample-rate-label="sampleRateLabel"
            :tracker-enabled="trackerEnabled"
            :pageviews="selectedPage?.pageviews"
            :used-in="usedIn"
            :height="paneHeight"
            :workspace="workspace"
            :workspace-snapshots="inventory?.snapshotsEnabled ?? false"
            @website-updated="putWebsite"
          />
        </div>
        <DmsEmptyState
          v-else-if="settled && pages.length > 0"
          icon="i-ph-cursor-click"
          class="dms-card"
          :title="t('page.marketing.pages.select_hint')"
        />
      </div>
      <p v-if="sampleRateLabel !== null" class="text-xs text-dimmed">
        {{
          t('page.marketing.pages.sampling_note', {
            rate: sampleRateLabel,
          })
        }}
      </p>
    </template>
  </div>
</template>
