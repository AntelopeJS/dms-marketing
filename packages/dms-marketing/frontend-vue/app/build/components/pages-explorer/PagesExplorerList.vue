<script setup lang="ts">
import { useI18n } from '#dms/frontend-module'
import type {
  MarketingPageEntry,
  MarketingPagesSort,
} from '../../../composables/useMarketingApi'
import { formatNumber } from '../../../utils/format'
import type { pageSnapshotBadge } from '../../../utils/page-snapshot'

/** The list of `PagesExplorer`: one row per path, its count in the sort's metric, its snapshot badge and a bar against the busiest path. */
defineProps<{
  rows: Array<
    MarketingPageEntry & { badge: ReturnType<typeof pageSnapshotBadge> }
  >
  loading: boolean
  paneHeight: number | null
  selectedPath: string | undefined
  sort: MarketingPagesSort
  maxMetric: number
  metricOf: (page: { pageviews: number; clicks: number }) => number
  pick: (path: string) => Promise<void>
}>()

const { t, locale } = useI18n()
</script>

<template>
  <ul
    class="flex flex-col gap-1 overflow-y-auto p-2"
    :class="[
      loading ? 'opacity-60' : '',
      paneHeight === null ? 'max-h-[45vh] xl:max-h-[70vh]' : 'min-h-0 flex-1',
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
            :class="page.path === selectedPath ? 'text-muted' : 'text-dimmed'"
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
</template>
