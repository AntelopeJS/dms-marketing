<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDmsRoute, useI18n } from '#dms/frontend-module'
import { useChildId } from '../composables/useChildId'
import { useLatestRequest } from '../composables/useLatestRequest'
import {
  useMarketingApi,
  type MarketingCampaignEntry,
  type MarketingCampaigns,
  type MarketingChannel,
} from '../composables/useMarketingApi'
import {
  MARKETING_PERIOD_PRESETS,
  ndToPreset,
  useMarketingPeriod,
} from '../composables/useMarketingPeriod'
import { useMarketingWebsites } from '../composables/useMarketingWebsites'

import type { TableColumn } from '@nuxt/ui'

/**
 * Acquisition surface: the five-channel split of sessions (donut) next to the
 * UTM campaign table — one row per (source, medium, campaign) triple observed
 * on new sessions — with UTM terms and contents as top lists below.
 *
 * Everything reads the daily rollups through one campaigns fetch; the search
 * box filters the table server-side because a day's map caps its entries and
 * the merged table can exceed what one response carries.
 */
const PERIOD_SCOPE = 'dms-marketing-campaigns'
const SEARCH_DEBOUNCE_MS = 300

// The DMS page renderer hands every component its identity; keeping it is what
// lets dms-ui primitives key their events and persisted state per child.
const props = withDefaults(
  defineProps<{ componentId?: string, pageId?: string }>(),
  { componentId: 'marketing-campaigns', pageId: 'marketing' },
)

const childId = useChildId(() => props.componentId)

const api = useMarketingApi()
const { t, te } = useI18n()
const route = useDmsRoute()

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
  selectedId,
  loading: loadingWebsites,
  failed: websitesFailed,
  load: loadWebsites,
  create: createWebsite,
} = useMarketingWebsites(queryParam('website'))

const period = useMarketingPeriod(PERIOD_SCOPE)
const search = ref('')

let searchTimer: ReturnType<typeof setTimeout> | null = null

const {
  data: acquisition,
  loading: loadingCampaigns,
  failed: campaignsFailed,
  settled: campaignsSettled,
  run: loadCampaigns,
} = useLatestRequest<MarketingCampaigns>(() =>
  // Server-side there is no session to authenticate with: the fetch belongs to
  // the client, like every other read here.
  selectedId.value && !import.meta.env.SSR
    ? api.getCampaigns(selectedId.value, period.value, search.value.trim())
    : null,
)

// The watcher owns every fetch, including the first: seeding it from onMounted
// as well would issue the initial request twice on a bare link, and not at all
// on a link that already names the site the list would have picked — resolving
// it writes back the same id, which is no change to watch.
watch([selectedId, period], () => {
  void loadCampaigns()
}, { immediate: true })

watch(search, () => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
  searchTimer = setTimeout(() => void loadCampaigns(), SEARCH_DEBOUNCE_MS)
})

onBeforeUnmount(() => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
})

const loading = computed(
  () =>
    loadingWebsites.value
    || loadingCampaigns.value
    || (!!selectedId.value && !campaignsSettled.value),
)

// Two failures, two flags: retrying the campaigns fetch must not clear the
// one that says the site list itself never loaded.
const failed = computed(() => websitesFailed.value || campaignsFailed.value)

/** Retry entry point: whichever of the two fetches has nothing to show. */
function reload() {
  return websites.value.length === 0 ? loadWebsites() : loadCampaigns()
}

onMounted(loadWebsites)

// --- Channels ---------------------------------------------------------------

/** Display order mirrors the backend's MARKETING_CHANNELS. */
const CHANNEL_ORDER: MarketingChannel[] = ['direct', 'organic', 'social', 'referral', 'paid']

/** Known channels localize; a key minted by a future classifier still shows. */
function channelLabel(channel: string): string {
  const key = `page.marketing.campaigns.channels.${channel}`
  return te(key) ? t(key) : channel
}

const channelRecords = computed(() => {
  const channels = acquisition.value?.channels ?? {}
  return CHANNEL_ORDER
    .map(channel => ({ label: channelLabel(channel), value: channels[channel] ?? 0 }))
    .filter(record => record.value > 0)
})

// --- Campaign table ---------------------------------------------------------

const campaignRows = computed(() => acquisition.value?.campaigns ?? [])
const truncated = computed(() => acquisition.value?.truncated ?? false)

const columns = computed<TableColumn<MarketingCampaignEntry>[]>(() => [
  { accessorKey: 'source', header: t('page.marketing.campaigns.table.source') },
  { accessorKey: 'medium', header: t('page.marketing.campaigns.table.medium') },
  { accessorKey: 'campaign', header: t('page.marketing.campaigns.table.campaign') },
  {
    accessorKey: 'sessions',
    header: t('page.marketing.campaigns.table.sessions'),
    meta: { class: { th: 'text-right', td: 'text-right' } },
  },
])

// --- Referrer / term / content top lists ------------------------------------

const TOP_LIST_LIMIT = 8

function toTopItems(record: Record<string, number> | undefined) {
  return Object.entries(record ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_LIST_LIMIT)
    .map(([label, value]) => ({ id: label, title: label, value }))
}

const topLists = computed(() => [
  // Referrer domains across all channels — the overview's acquisition card
  // links here for this detail.
  {
    id: 'referrers',
    title: t('page.marketing.campaigns.top.referrers'),
    items: toTopItems(acquisition.value?.referrers),
  },
  {
    id: 'terms',
    title: t('page.marketing.campaigns.top.terms'),
    items: toTopItems(acquisition.value?.terms),
  },
  {
    id: 'contents',
    title: t('page.marketing.campaigns.top.contents'),
    items: toTopItems(acquisition.value?.contents),
  },
])
</script>

<template>
  <div class="space-y-6 p-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold">{{ t('page.marketing.campaigns.title') }}</h1>
        <p class="text-sm text-muted">{{ t('page.marketing.campaigns.subtitle') }}</p>
      </div>
      <div class="flex items-center gap-3">
        <USelect
          v-if="websites.length > 1"
          v-model="selectedId"
          :items="websiteItems"
          class="w-56"
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
          icon="i-ph-arrow-clockwise"
          color="neutral"
          variant="subtle"
          size="sm"
          :loading="loading"
          @click="loadCampaigns"
        />
      </div>
    </div>

    <div v-if="failed" class="flex flex-col items-start gap-3">
      <UAlert
        color="error"
        variant="subtle"
        icon="i-ph-warning-circle"
        :title="t('page.marketing.campaigns.error.title')"
        :description="t('page.marketing.campaigns.error.description')"
      />
      <UButton
        icon="i-ph-arrow-clockwise"
        :label="t('page.marketing.campaigns.retry')"
        color="neutral"
        variant="subtle"
        size="sm"
        @click="reload"
      />
    </div>

    <DmsMarketingNoWebsiteState
      v-else-if="!loading && websites.length === 0"
      icon="i-ph-megaphone"
      :title="t('page.marketing.campaigns.empty.title')"
      :description="t('page.marketing.campaigns.empty.description')"
      @create="createWebsite"
    />

    <!-- Only before the first answer: a refetch keeps the tables on screen
    and spins the refresh button instead. -->
    <USkeleton v-else-if="loading && !acquisition" class="h-96 w-full" />

    <template v-else>
      <div class="grid gap-4 lg:grid-cols-3">
        <UCard>
          <template #header>
            <div>
              <p class="font-medium">{{ t('page.marketing.campaigns.channels.title') }}</p>
              <p class="text-sm text-muted">{{ t('page.marketing.campaigns.channels.subtitle') }}</p>
            </div>
          </template>
          <DmsChart
            v-if="channelRecords.length > 0"
            :component-id="childId('channels')"
            :page-id="props.pageId"
            type="donut"
            :static-dataset="channelRecords"
            height="300px"
            :show-total="true"
          />
          <p v-else class="py-12 text-center text-sm text-muted">
            {{ t('page.marketing.campaigns.channels.empty') }}
          </p>
        </UCard>

        <UCard class="lg:col-span-2">
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="font-medium">{{ t('page.marketing.campaigns.table.title') }}</p>
                <p class="text-sm text-muted">{{ t('page.marketing.campaigns.table.subtitle') }}</p>
              </div>
              <UInput
                v-model="search"
                icon="i-ph-magnifying-glass"
                :placeholder="t('page.marketing.campaigns.table.search_placeholder')"
                class="w-56"
              />
            </div>
          </template>
          <UTable :data="campaignRows" :columns="columns">
            <template #source-cell="{ row }">
              <span v-if="row.original.source">{{ row.original.source }}</span>
              <span v-else class="text-muted">—</span>
            </template>
            <template #medium-cell="{ row }">
              <span v-if="row.original.medium">{{ row.original.medium }}</span>
              <span v-else class="text-muted">—</span>
            </template>
            <template #campaign-cell="{ row }">
              <span v-if="row.original.campaign">{{ row.original.campaign }}</span>
              <span v-else class="text-muted">—</span>
            </template>
            <template #empty>
              <p class="py-8 text-center text-sm text-muted">
                {{ t('page.marketing.campaigns.table.empty') }}
              </p>
            </template>
          </UTable>
          <p v-if="truncated" class="mt-2 text-sm text-muted">
            {{ t('page.marketing.campaigns.table.truncated') }}
          </p>
        </UCard>
      </div>

      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <DmsTopListCard
          v-for="list in topLists"
          :key="list.id"
          :component-id="childId(`top-${list.id}`)"
          :page-id="props.pageId"
          :title="list.title"
          :static-items="list.items"
          :show-delta="false"
          :empty-label="t('page.marketing.campaigns.top.empty')"
        />
      </div>
    </template>
  </div>
</template>
