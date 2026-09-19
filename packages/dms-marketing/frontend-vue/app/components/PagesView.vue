<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  useDmsRoute,
  useDmsRouter,
  useI18n,
} from '#dms/frontend-module'
import { useChildId } from '../composables/useChildId'
import { useLatestRequest } from '../composables/useLatestRequest'
import {
  useMarketingApi,
  type MarketingPages,
} from '../composables/useMarketingApi'
import {
  MARKETING_PERIOD_PRESETS,
  ndToPreset,
  useMarketingPeriod,
} from '../composables/useMarketingPeriod'
import { funnelsLink, pagesLink } from '../composables/useMarketingRoutes'
import { useMarketingWebsites } from '../composables/useMarketingWebsites'

/**
 * Tracked pages of a site: the inventory on the left, the clicks and scroll
 * depth of the selected page on the right.
 *
 * The surface is deliberately keyed on nothing but a website id and a bare
 * pathname the tracker itself reported — no route registry, no sitemap, no
 * build manifest, no framework convention. That is what makes it hold for any
 * tracked site, whatever it is built with.
 *
 * The search box is also a path field, and that is not a fallback: a day keeps
 * at most MAX_ENTRIES_PER_TOP_MAP paths and older days keep counters only, so
 * a page can be missing from the inventory while its clicks are perfectly
 * queryable — the backend matches the path exactly either way.
 */
const PERIOD_SCOPE = 'dms-marketing-pages'
const SEARCH_DEBOUNCE_MS = 300

// Declared, not inherited as attributes: the DMS page renderer hands every
// component its identity, and an undeclared prop lands on the root element.
const props = withDefaults(
  defineProps<{ componentId?: string, pageId?: string }>(),
  { componentId: 'marketing-pages', pageId: 'marketing' },
)

const childId = useChildId(() => props.componentId)

const api = useMarketingApi()
const { t } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()

const queryParam = (key: string): string => {
  const value = route.query[key]
  return typeof value === 'string' ? value : ''
}

// Read once: the selector seeds its preset at init and never reactively, so a
// deep link's window has to be resolved before it renders.
const initialPreset = ndToPreset(queryParam('period'))

const {
  websites,
  items: websiteItems,
  selectedId: selectedWebsiteId,
  selected: selectedWebsite,
  loading: loadingWebsites,
  failed: websitesFailed,
  load: loadWebsites,
  create: createWebsite,
} = useMarketingWebsites(queryParam('website'))

// `undefined`, not null: this is what DmsMasterDetail's model is typed on.
const selectedPath = ref<string | undefined>(queryParam('path') || undefined)
const search = ref('')

const period = useMarketingPeriod(PERIOD_SCOPE)

let searchTimer: ReturnType<typeof setTimeout> | null = null

const {
  data: inventory,
  loading: loadingPages,
  settled: pagesSettled,
  failed: pagesFailed,
  run: loadPages,
} = useLatestRequest<MarketingPages>(() =>
  // Server-side there is no session to authenticate with: the fetch belongs to
  // the client, like every other read here.
  selectedWebsiteId.value && !import.meta.env.SSR
    ? api.listPages(selectedWebsiteId.value, period.value, search.value.trim())
    : null,
)

const pages = computed(() => inventory.value?.pages ?? [])
const truncated = computed(() => inventory.value?.truncated ?? false)
const sampleRate = computed(() => inventory.value?.heatmapSampleRate ?? 0)
const trackerEnabled = computed(() => inventory.value?.trackerEnabled ?? true)

// Two failures, two flags: the inventory fetch clears its own error on every
// attempt, and must not clear the one that says the site list never loaded.
const failed = computed(() => websitesFailed.value || pagesFailed.value)

// A selected site means an inventory request is expected. Keep the surface
// visibly loading through the first answer instead of rendering an empty
// master/detail shell while websites, pages and the preview requests settle.
const loading = computed(
  () =>
    loadingWebsites.value
    || loadingPages.value
    || (!!selectedWebsiteId.value && !pagesSettled.value),
)

// Land on something rather than on an empty pane, but never override a path
// that was linked to or typed. Watching the answer rather than writing from
// the fetch keeps superseded ones out: only the newest ever reaches here.
watch(inventory, (data) => {
  if (!selectedPath.value) {
    selectedPath.value = data?.pages[0]?.path
  }
})

/**
 * Retry entry point. Both fetches, in order, because either can be the one
 * that failed: on a deep link the inventory runs even when the site list did
 * not, and reloading the list alone leaves the selection unchanged, so the
 * watcher never fires and the inventory is never retried.
 */
async function reload() {
  if (websites.value.length === 0) {
    await loadWebsites()
  }
  await loadPages()
}

onMounted(loadWebsites)

// The watcher owns every inventory fetch, including the first: seeding it from
// onMounted as well would issue the initial request twice on a bare link, and
// not at all on a link that already names the site the list would have picked.
watch([selectedWebsiteId, period], ([websiteId], previous) => {
  // Switching site invalidates the path — the same URL on another site is
  // another page, and usually does not exist there. Only a real site-to-site
  // change may clear: the immediate run hands multi-source watchers an EMPTY
  // previous array (truthy — `previous &&` does not guard it), and the site
  // list resolving undefined → id is not a switch either. Both carry a linked
  // path that must survive.
  const previousWebsiteId = previous?.[0]
  if (previousWebsiteId !== undefined && websiteId !== previousWebsiteId) {
    selectedPath.value = undefined
  }
  void loadPages()
}, { immediate: true })

watch(search, () => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
  searchTimer = setTimeout(() => void loadPages(), SEARCH_DEBOUNCE_MS)
})

onBeforeUnmount(() => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
})

/** Enter inspects what was typed, whether or not the inventory lists it. */
function inspectTyped(): void {
  const typed = search.value.trim()
  if (!typed.startsWith('/')) {
    return
  }
  selectedPath.value = typed
}

// State lives in the URL so a heatmap can be linked to. Query-only navigation
// does not remount the page, so this is free.
watch([selectedWebsiteId, selectedPath, period], () => {
  void router.replace(
    pagesLink({
      website: selectedWebsiteId.value,
      path: selectedPath.value,
      period: period.value,
    }),
  )
})

const pageviewsBySelected = computed(
  () => pages.value.find(page => page.path === selectedPath.value)?.pageviews,
)

const listItems = computed(() =>
  pages.value.map((page) => {
    // Sampled PAGE LOADS, not clicks: the tracker draws once per page load,
    // so this says whether a heatmap can exist at all — a click estimate here
    // would contradict the real count shown beside it in the detail pane.
    const sampled = Math.round(page.pageviews * sampleRate.value)
    // Two counts, two plural choices: one message could only ever inflect on
    // one of them, and the two rarely agree.
    return {
      value: page.path,
      label: page.path,
      sublabel: [
        t('page.marketing.pages.row_hint.views', { count: page.pageviews }, page.pageviews),
        t('page.marketing.pages.row_hint.sampled', { count: sampled }, sampled),
      ].join(' · '),
    }
  }),
)

// --- Site-wide reset --------------------------------------------------------

const { confirm } = useConfirm()
const toast = useToast()
const resettingHeatmaps = ref(false)

/**
 * The detail pane refetches on this bump: a site-wide reset changes none of
 * the keys it watches (site, path, period), so without it the pane would keep
 * showing clicks that no longer exist. The inventory needs no reload — its
 * pageview counts come from the rollup, which a click purge never touches.
 */
const heatmapRefreshToken = ref(0)

async function resetSiteHeatmaps() {
  const site = selectedWebsite.value
  if (!site) {
    return
  }
  const confirmed = await confirm({
    title: t('page.marketing.pages.reset.site_title'),
    description: t('page.marketing.pages.reset.site_description', { name: site.name }),
    confirmLabel: t('page.marketing.pages.reset.confirm'),
    confirmColor: 'error',
  })
  if (!confirmed) {
    return
  }
  resettingHeatmaps.value = true
  try {
    const { deleted } = await api.resetHeatmap(site._id)
    toast.add({
      color: 'success',
      title: t('page.marketing.pages.reset.done', { count: deleted }, deleted),
    })
    heatmapRefreshToken.value++
  }
  catch {
    toast.add({ color: 'error', title: t('page.marketing.pages.reset.error') })
  }
  finally {
    resettingHeatmaps.value = false
  }
}
</script>

<template>
  <div class="space-y-6 p-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold">{{ t('page.marketing.pages.title') }}</h1>
        <p class="text-sm text-muted">{{ t('page.marketing.pages.subtitle') }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <USelect
          v-if="websites.length > 1"
          v-model="selectedWebsiteId"
          :items="websiteItems"
          class="w-56"
        />
        <UInput
          v-model="search"
          icon="i-ph-magnifying-glass"
          class="w-64"
          :placeholder="t('page.marketing.pages.search_placeholder')"
          @keyup.enter="inspectTyped"
        />
        <DmsPeriodSelector
          :id="PERIOD_SCOPE"
          :component-id="childId('period')"
          :page-id="props.pageId"
          :default-preset="initialPreset"
          :presets="MARKETING_PERIOD_PRESETS"
          :comparisons="['none']"
          :show-range-label="false"
        />
        <UButton
          v-if="selectedWebsiteId"
          icon="i-ph-funnel"
          color="neutral"
          variant="ghost"
          size="sm"
          :to="funnelsLink({ website: selectedWebsiteId })"
          :label="t('page.marketing.pages.to_funnels')"
        />
        <UButton
          v-if="selectedWebsiteId"
          icon="i-ph-eraser"
          color="neutral"
          variant="ghost"
          size="sm"
          :loading="resettingHeatmaps"
          :label="t('page.marketing.pages.reset.site_button')"
          @click="resetSiteHeatmaps"
        />
      </div>
    </div>

    <UAlert
      v-if="!trackerEnabled"
      icon="i-ph-plugs"
      color="warning"
      variant="subtle"
      :title="t('page.marketing.pages.tracking_off.title')"
      :description="t('page.marketing.pages.tracking_off.description')"
    />

    <div v-if="failed" class="flex flex-col items-start gap-3">
      <UAlert
        color="error"
        variant="subtle"
        icon="i-ph-warning-circle"
        :title="t('page.marketing.pages.error')"
        :description="t('page.marketing.pages.error_hint')"
      />
      <UButton
        icon="i-ph-arrow-clockwise"
        :label="t('page.marketing.pages.retry')"
        color="neutral"
        variant="subtle"
        size="sm"
        @click="reload"
      />
    </div>

    <USkeleton v-else-if="loadingWebsites" class="h-96 w-full" />

    <DmsMarketingNoWebsiteState
      v-else-if="websites.length === 0"
      icon="i-ph-globe"
      :title="t('page.marketing.pages.no_website.title')"
      :description="t('page.marketing.pages.no_website.description')"
      @create="createWebsite"
    />

    <template v-else>
      <USkeleton v-if="loading" class="h-96 w-full" />

      <UAlert
        v-else-if="truncated"
        icon="i-ph-list"
        color="neutral"
        variant="subtle"
        :title="t('page.marketing.pages.list_truncated')"
        :description="t('page.marketing.pages.list_truncated_hint')"
      />

      <!-- An empty inventory is not an empty surface: a typed path is
           inspectable whether or not the rollup ever listed it. -->
      <UAlert
        v-if="!loadingPages && pages.length === 0 && !selectedPath"
        icon="i-ph-cursor-click"
        :title="t('page.marketing.pages.no_pages.title')"
        :description="t('page.marketing.pages.no_pages.description')"
      />

      <DmsMasterDetail
        v-else-if="!loading"
        v-model="selectedPath"
        :items="listItems"
        :list-label="t('page.marketing.pages.inventory')"
      >
        <DmsMarketingPagePreview
          v-if="selectedPath"
          :website="selectedWebsite"
          :path="selectedPath"
          :period="period"
          :sample-rate="sampleRate"
          :tracker-enabled="trackerEnabled"
          :pageviews="pageviewsBySelected"
          :refresh-token="heatmapRefreshToken"
          @website-updated="loadWebsites"
        />
        <div v-else class="p-8 text-center text-sm text-muted">
          {{ t('page.marketing.pages.select_hint') }}
        </div>
      </DmsMasterDetail>
    </template>
  </div>
</template>
