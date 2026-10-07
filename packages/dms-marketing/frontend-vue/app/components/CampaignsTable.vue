<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '#dms/frontend-module'
import { channelStyle } from '../utils/channels'
import { formatNumber, formatPercent } from '../utils/format'
import { sparklinePath } from '../utils/sparkline'

/**
 * Every UTM-tagged source × medium × campaign of the period, with its share,
 * a sparkline of its sessions per day, the channel its sessions land in and a
 * flag on the rows tagged without a medium (they count as direct).
 */
interface CampaignRow {
  key: string
  source?: string
  medium?: string
  campaign?: string
  channel: string
  sessions: number
  share: number
  daily: number[]
  missingMedium: boolean
}

interface CampaignsResponse {
  rows: CampaignRow[]
  truncated: boolean
  totalSessions: number
  taggedSessions: number
  missingMediumSessions: number
}

const props = withDefaults(
  defineProps<{
    fetchUrl: string
    periodScope?: string
    componentId?: string
    pageId?: string
  }>(),
  { periodScope: undefined, componentId: undefined, pageId: undefined },
)

const ALL = 'all'
const SPARK_WIDTH = 84
const SPARK_HEIGHT = 20
const SKELETON_ROWS = 6

const { t, locale } = useI18n()

const { data, isLoading, error, refresh } = useChartFetch<CampaignsResponse>({
  fetchUrl: props.fetchUrl,
  periodScope: props.periodScope,
})

const search = ref('')
const channel = ref(ALL)

// The first read holds the top rows only; past them, a filter has to ask the
// route, which searches every combination of the period.
const SEARCH_DEBOUNCE_MS = 300
const scope = usePeriodScope(props.periodScope)
const { $authFetch } = useAuthFetch()
const searched = ref<CampaignsResponse | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | null = null

async function searchServer(needle: string): Promise<void> {
  const url = `${props.fetchUrl}?search=${encodeURIComponent(needle)}`
  try {
    searched.value = await $authFetch<CampaignsResponse>(
      appendPeriodToUrl(url, scope.value),
    )
  } catch {
    searched.value = null
  }
}

watch([search, () => data.value], ([value]) => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
  const needle = value.trim()
  if (!needle || !data.value?.truncated) {
    searched.value = null
    return
  }
  searchTimer = setTimeout(() => void searchServer(needle), SEARCH_DEBOUNCE_MS)
})

const rows = computed(() => (searched.value ?? data.value)?.rows ?? [])

const channelTabs = computed(() => {
  const present = [...new Set(rows.value.map((row) => row.channel))]
  return [
    { value: ALL, label: t('page.marketing.acquisition.campaigns.all') },
    ...present.map((id) => ({
      value: id,
      label: t(`page.marketing.channels.${id}`),
    })),
  ]
})

const visible = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    if (channel.value !== ALL && row.channel !== channel.value) {
      return false
    }
    return (
      !needle ||
      [row.source, row.medium, row.campaign].some((part) =>
        part?.toLowerCase().includes(needle),
      )
    )
  })
})

const taggedShare = computed(() =>
  data.value && data.value.totalSessions > 0
    ? (data.value.taggedSessions / data.value.totalSessions) * 100
    : 0,
)
</script>

<template>
  <div class="flex flex-col gap-3">
    <section class="dms-card overflow-hidden p-0">
      <header
        class="flex flex-wrap items-center gap-3 border-b border-default px-4 py-3"
      >
        <h3
          class="flex items-center gap-2 text-sm font-semibold text-highlighted"
        >
          {{ t('page.marketing.acquisition.campaigns.title') }}
          <span class="font-mono text-xs font-normal text-dimmed">
            {{ rows.length }}
          </span>
        </h3>
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UInput
            v-model="search"
            size="xs"
            icon="i-ph-magnifying-glass"
            class="w-60"
            :placeholder="t('page.marketing.acquisition.campaigns.filter')"
          />
          <DmsSegmented v-model="channel" :items="channelTabs" size="xs" />
        </div>
      </header>

      <DmsEmptyState
        v-if="error && !data"
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
            @click="refresh"
          />
        </template>
      </DmsEmptyState>

      <DmsEmptyState
        v-else-if="data && rows.length === 0"
        icon="i-ph-megaphone"
        hatched
        :title="t('page.marketing.acquisition.campaigns.empty_title')"
        :description="
          t('page.marketing.acquisition.campaigns.empty_description')
        "
      />

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[860px] text-sm">
          <thead>
            <tr
              class="text-left font-mono text-[10px] tracking-widest text-dimmed uppercase"
            >
              <th class="px-4 py-2 font-normal">
                {{ t('page.marketing.acquisition.campaigns.campaign') }}
              </th>
              <th class="px-2 py-2 font-normal">
                {{ t('page.marketing.acquisition.campaigns.source') }}
              </th>
              <th class="px-2 py-2 font-normal">
                {{ t('page.marketing.acquisition.campaigns.medium') }}
              </th>
              <th class="px-2 py-2 font-normal">
                {{ t('page.marketing.acquisition.campaigns.channel') }}
              </th>
              <th class="px-2 py-2 text-right font-normal">
                {{ t('page.marketing.acquisition.campaigns.sessions') }}
              </th>
              <th class="px-2 py-2 text-right font-normal">
                {{ t('page.marketing.acquisition.campaigns.share') }}
              </th>
              <th class="px-2 py-2 font-normal">
                {{ t('page.marketing.acquisition.campaigns.per_day') }}
              </th>
              <th class="px-4 py-2 font-normal">
                {{ t('page.marketing.acquisition.campaigns.flags') }}
              </th>
            </tr>
          </thead>
          <tbody v-if="isLoading && !data" aria-hidden="true">
            <tr
              v-for="index in SKELETON_ROWS"
              :key="index"
              class="border-t border-default"
            >
              <td class="px-4 py-3" colspan="8">
                <USkeleton class="h-4 w-full" />
              </td>
            </tr>
          </tbody>
          <tbody v-else :class="isLoading ? 'opacity-60' : ''">
            <tr
              v-for="row in visible"
              :key="row.key"
              class="border-t border-default"
            >
              <td
                class="px-4 py-2.5 font-mono text-[13px]"
                :class="
                  row.campaign ? 'text-highlighted' : 'text-dimmed italic'
                "
              >
                {{
                  row.campaign ??
                  t('page.marketing.acquisition.campaigns.not_set')
                }}
              </td>
              <td class="px-2 py-2.5 font-mono text-[13px] text-toned">
                {{ row.source ?? '—' }}
              </td>
              <td class="px-2 py-2.5 font-mono text-[13px] text-toned">
                {{ row.medium ?? '—' }}
              </td>
              <td class="px-2 py-2.5">
                <span
                  class="inline-flex items-center gap-1.5 text-[13px] text-muted"
                >
                  <UIcon
                    :name="channelStyle(row.channel).icon"
                    class="size-3.5"
                  />
                  {{ t(`page.marketing.channels.${row.channel}`) }}
                </span>
              </td>
              <td
                class="px-2 py-2.5 text-right font-mono font-semibold tabular-nums text-highlighted"
              >
                {{ formatNumber(row.sessions, locale) }}
              </td>
              <td
                class="px-2 py-2.5 text-right font-mono tabular-nums text-muted"
              >
                {{ formatPercent(row.share, locale) }}
              </td>
              <td class="px-2 py-2.5">
                <svg
                  :width="SPARK_WIDTH"
                  :height="SPARK_HEIGHT"
                  class="overflow-visible text-primary"
                  aria-hidden="true"
                >
                  <path
                    :d="sparklinePath(row.daily, SPARK_WIDTH, SPARK_HEIGHT)"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.25"
                  />
                </svg>
              </td>
              <td class="px-4 py-2.5">
                <DmsStatusPill
                  v-if="row.missingMedium"
                  tone="warning"
                  size="sm"
                  icon="i-ph-warning"
                  :mono="false"
                  :label="
                    t('page.marketing.acquisition.campaigns.missing_medium')
                  "
                />
                <span v-else class="text-dimmed">—</span>
              </td>
            </tr>
            <tr v-if="visible.length === 0" class="border-t border-default">
              <td colspan="8" class="px-4 py-8 text-center text-sm text-muted">
                {{ t('page.marketing.acquisition.campaigns.no_match') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer
        v-if="data && rows.length > 0"
        class="flex flex-wrap items-center justify-between gap-2 border-t border-default px-4 py-2.5 text-xs text-muted"
      >
        <span>
          <span class="font-mono text-highlighted">
            {{ formatNumber(data.taggedSessions, locale) }}
          </span>
          {{
            t('page.marketing.acquisition.campaigns.tagged', {
              share: formatPercent(taggedShare, locale),
            })
          }}
        </span>
        <span class="flex items-center gap-1.5 text-dimmed">
          <UIcon name="i-ph-info" class="size-3.5" />
          {{ t('page.marketing.acquisition.campaigns.note') }}
        </span>
      </footer>
    </section>

    <DmsBanner
      v-if="data?.truncated"
      tone="info"
      size="sm"
      icon="i-ph-list"
      :title="t('page.marketing.acquisition.campaigns.truncated_title')"
      :description="
        t('page.marketing.acquisition.campaigns.truncated_description')
      "
    />
    <DmsBanner
      v-if="data && data.missingMediumSessions > 0"
      tone="warning"
      size="sm"
      :title="
        t('page.marketing.acquisition.campaigns.missing_title', {
          count: formatNumber(data.missingMediumSessions, locale),
        })
      "
      :description="
        t('page.marketing.acquisition.campaigns.missing_description')
      "
    />
  </div>
</template>
