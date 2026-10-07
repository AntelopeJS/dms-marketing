<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDmsRoute, useDmsRouter, useI18n } from '#dms/frontend-module'
import { useLatestRequest } from '../composables/useLatestRequest'
import {
  useMarketingApi,
  type MarketingFunnelListItem,
  type MarketingPages,
  type MarketingWebsite,
} from '../composables/useMarketingApi'
import { useMarketingContext } from '../composables/useMarketingContext'
import { pagesLink } from '../composables/useMarketingRoutes'
import { parseFunnelStepsValue } from '../composables/useFunnelSteps'
import { formatNumber, formatPercent } from '../utils/format'

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
  { periodScope: undefined, componentId: undefined, pageId: undefined },
)

const SEARCH_DEBOUNCE_MS = 300
const SKELETON_ROWS = 8

void props

const { t, locale } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const api = useMarketingApi()
const context = useMarketingContext()
const toast = useToast()
const { confirm } = useConfirm()

const websiteId = computed(() => context.selected.value?.id ?? '')

const queryPath = () =>
  typeof route.query.path === 'string' ? route.query.path : ''
const selectedPath = ref<string | undefined>(queryPath() || undefined)
const search = ref('')

// The full row: the context carries the id, the preview needs the snapshot options.
const website = ref<MarketingWebsite | null>(null)

async function loadWebsite(): Promise<void> {
  const list = await api.listWebsites()
  website.value = list.find((site) => site._id === websiteId.value) ?? null
}

const {
  data: inventory,
  loading,
  settled,
  failed,
  run: loadPages,
} = useLatestRequest<MarketingPages>(() =>
  websiteId.value && !import.meta.env.SSR
    ? api.listPages(websiteId.value, context.period.value, search.value.trim())
    : null,
)

const funnels = ref<MarketingFunnelListItem[]>([])

async function loadFunnels(): Promise<void> {
  try {
    funnels.value = (await api.listFunnels(websiteId.value)).results
  } catch {
    funnels.value = []
  }
}

watch(
  [websiteId, context.period, context.refreshToken],
  ([id], previous) => {
    if (previous?.[0] !== undefined && id !== previous[0]) {
      selectedPath.value = undefined
    }
    if (id) {
      void loadPages()
      void loadWebsite()
      void loadFunnels()
    }
  },
  { immediate: true },
)

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
  searchTimer = setTimeout(() => void loadPages(), SEARCH_DEBOUNCE_MS)
})
onBeforeUnmount(() => searchTimer && clearTimeout(searchTimer))

const pages = computed(() => inventory.value?.pages ?? [])
const sampleRate = computed(() => inventory.value?.heatmapSampleRate ?? 0)
const trackerEnabled = computed(() => inventory.value?.trackerEnabled ?? true)
const maxViews = computed(() =>
  Math.max(1, ...pages.value.map((page) => page.pageviews)),
)

watch(inventory, (data) => {
  if (!selectedPath.value) {
    selectedPath.value = data?.pages[0]?.path
  }
})

watch(selectedPath, (path) => {
  void router.replace(pagesLink(path))
})

/** Enter inspects what was typed, listed or not. */
function inspectTyped(): void {
  const typed = search.value.trim()
  if (typed.startsWith('/')) {
    selectedPath.value = typed
  }
}

const selectedViews = computed(
  () => pages.value.find((page) => page.path === selectedPath.value)?.pageviews,
)

/** Funnels with a page step on the selected path, for the "Used in" card. */
const usedIn = computed(() =>
  funnels.value.filter((funnel) =>
    parseFunnelStepsValue(funnel.steps).some(
      (step) => step.kind === 'url' && step.value === selectedPath.value,
    ),
  ),
)

const refreshToken = ref(0)

// Client-only: the server renders no session, so its markup (an empty list)
// would not match the client's and hydration would misplace the preview.
const mounted = ref(false)
onMounted(() => (mounted.value = true))

async function resetSite(): Promise<void> {
  const site = website.value
  if (!site) {
    return
  }
  await confirm({
    title: t('page.marketing.pages.reset.site_title', { name: site.name }),
    description: t('page.marketing.pages.reset.site_description'),
    color: 'error',
    icon: 'i-ph-eraser',
    confirmLabel: t('page.marketing.pages.reset.confirm'),
    confirmText: site.domain,
    impact: [
      {
        icon: 'i-ph-cursor-click',
        label: t('page.marketing.pages.reset.impact_clicks'),
      },
      {
        icon: 'i-ph-check',
        label: t('page.marketing.pages.reset.impact_kept'),
      },
    ],
    onConfirm: async () => {
      const { deleted } = await api.resetHeatmap(site._id)
      toast.add({
        color: 'success',
        title: t('page.marketing.pages.reset.done', {
          count: formatNumber(deleted, locale.value),
        }),
      })
      refreshToken.value++
    },
  })
}

const moreItems = computed(() => [
  [
    {
      label: t('page.marketing.pages.reset.site_button'),
      icon: 'i-ph-eraser',
      color: 'error' as const,
      onSelect: () => void resetSite(),
    },
  ],
])
</script>

<template>
  <div class="flex flex-col gap-4">
    <DmsBanner
      v-if="!trackerEnabled"
      tone="error"
      size="sm"
      icon="i-ph-plugs"
      :title="t('page.marketing.pages.tracking_off.title')"
      :description="t('page.marketing.pages.tracking_off.description')"
    />

    <div
      v-if="!mounted"
      class="grid items-start gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]"
      aria-hidden="true"
    >
      <USkeleton class="h-[32rem] rounded-xl" />
      <USkeleton class="h-[32rem] rounded-xl" />
    </div>
    <div
      v-else
      class="grid items-start gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]"
    >
      <section
        class="dms-card flex flex-col overflow-hidden p-0 xl:sticky xl:top-4"
      >
        <div class="flex items-center gap-2 border-b border-default p-3">
          <UInput
            v-model="search"
            size="sm"
            icon="i-ph-magnifying-glass"
            class="flex-1"
            :placeholder="t('page.marketing.pages.search_placeholder')"
            @keyup.enter="inspectTyped"
          />
          <UDropdownMenu :items="moreItems" :content="{ align: 'end' }">
            <UButton
              icon="i-ph-dots-three"
              size="sm"
              color="neutral"
              variant="ghost"
              :aria-label="t('page.marketing.common.more')"
            />
          </UDropdownMenu>
        </div>
        <div class="flex items-center justify-between px-4 py-2">
          <DmsEyebrow
            :label="t('page.marketing.pages.count', { count: pages.length })"
          />
          <DmsEyebrow :label="t('page.marketing.pages.views')" />
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
          v-else-if="pages.length === 0 && !selectedPath"
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
          class="flex max-h-[70vh] flex-col gap-1 overflow-y-auto p-2"
          :class="loading ? 'opacity-60' : ''"
        >
          <li v-for="page in pages" :key="page.path">
            <button
              type="button"
              class="flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors"
              :class="
                page.path === selectedPath
                  ? 'border-primary bg-primary/10'
                  : 'border-transparent hover:bg-elevated'
              "
              @click="selectedPath = page.path"
            >
              <span class="flex items-center gap-2">
                <span
                  class="flex-1 truncate font-mono text-[13px]"
                  :class="
                    page.path === selectedPath
                      ? 'text-primary'
                      : 'text-highlighted'
                  "
                >
                  {{ page.path }}
                </span>
                <span class="font-mono text-xs tabular-nums text-highlighted">
                  {{ formatNumber(page.pageviews, locale) }}
                </span>
              </span>
              <span class="flex items-center gap-2">
                <span
                  class="flex flex-1 items-center gap-1 text-[11px] text-dimmed"
                >
                  <UIcon name="i-ph-cursor-click" class="size-3" />
                  {{
                    t('page.marketing.pages.sampled', {
                      count: formatNumber(
                        Math.round(page.pageviews * sampleRate),
                        locale,
                      ),
                    })
                  }}
                </span>
                <span class="h-1 w-14 overflow-hidden rounded-full bg-elevated">
                  <span
                    class="block h-full rounded-full bg-gradient-to-r from-success via-warning to-error"
                    :style="{ width: `${(page.pageviews / maxViews) * 100}%` }"
                  />
                </span>
              </span>
            </button>
          </li>
        </ul>
        <footer
          class="flex items-center gap-1.5 border-t border-default px-4 py-2.5 text-xs text-dimmed"
        >
          <UIcon name="i-ph-info" class="size-3.5" />
          {{
            inventory?.truncated
              ? t('page.marketing.pages.list_truncated')
              : t('page.marketing.pages.missing_hint')
          }}
        </footer>
      </section>

      <DmsMarketingPagePreview
        v-if="selectedPath && website"
        :website="website"
        :path="selectedPath"
        :period="context.period.value"
        :sample-rate="sampleRate"
        :tracker-enabled="trackerEnabled"
        :pageviews="selectedViews"
        :refresh-token="refreshToken + context.refreshToken.value"
        :used-in="usedIn"
        @website-updated="loadWebsite"
      />
      <DmsEmptyState
        v-else-if="settled && pages.length > 0"
        icon="i-ph-cursor-click"
        class="dms-card"
        :title="t('page.marketing.pages.select_hint')"
      />
    </div>
    <p v-if="sampleRate > 0" class="text-xs text-dimmed">
      {{
        t('page.marketing.pages.sampling_note', {
          rate: formatPercent(sampleRate * 100, locale, 0),
        })
      }}
    </p>
  </div>
</template>
