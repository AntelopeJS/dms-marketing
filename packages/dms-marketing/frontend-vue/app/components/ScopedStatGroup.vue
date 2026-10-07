<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '#dms/frontend-module'
import {
  formatDuration,
  formatNumber,
  formatPercent,
  formatSignedDelta,
} from '../utils/format'

/**
 * A `StatGroup` that follows a period scope: the stock block reads a route
 * once, this one refetches with the period like the KPI cards around it, and
 * formats the figures for the locale (durations, points of percentage).
 */
interface ScopedStatItem {
  id: string
  eyebrow: string
  icon: string
  value: number | null
  format: 'percent' | 'duration' | 'number' | 'text'
  delta?: number | null
  deltaFormat?: 'points' | 'seconds' | 'number' | 'percent'
  invert?: boolean
}

interface ScopedStatResponse {
  items: ScopedStatItem[]
}

const props = withDefaults(
  defineProps<{
    fetchUrl: string
    periodScope?: string
    label?: string
    layout?: 'joined' | 'cards'
    skeletonCount?: number
    componentId?: string
    pageId?: string
  }>(),
  {
    periodScope: undefined,
    label: undefined,
    layout: 'joined',
    skeletonCount: 3,
    componentId: undefined,
    pageId: undefined,
  },
)

const { t, locale } = useI18n()
const { processI18n } = useTranslation()

const { data, isLoading, error, refresh } = useChartFetch<ScopedStatResponse>({
  fetchUrl: props.fetchUrl,
  periodScope: props.periodScope,
})

const NO_VALUE = '—'

const VALUE_FORMATS: Record<
  ScopedStatItem['format'],
  (value: number) => string
> = {
  percent: (value) => formatPercent(value, locale.value),
  duration: (value) => formatDuration(value),
  number: (value) => formatNumber(value, locale.value, 1),
  text: (value) => String(value),
}

/** Good is up unless the item says lower is better. */
function deltaTone(item: ScopedStatItem): 'success' | 'error' | 'neutral' {
  const delta = item.delta ?? 0
  if (Math.abs(delta) < 0.05) {
    return 'neutral'
  }
  const better = item.invert ? delta < 0 : delta > 0
  return better ? 'success' : 'error'
}

const items = computed(() =>
  (data.value?.items ?? []).map((item) => ({
    id: item.id,
    icon: item.icon,
    eyebrow: processI18n(item.eyebrow),
    value:
      item.value === null ? NO_VALUE : VALUE_FORMATS[item.format](item.value),
    detail:
      item.delta === null || item.delta === undefined || !item.deltaFormat
        ? undefined
        : `${formatSignedDelta(item.delta, item.deltaFormat, locale.value)} · ${t('page.marketing.context.vs_previous_short')}`,
    detailTone: deltaTone(item),
  })),
)
</script>

<template>
  <div>
    <DmsEmptyState
      v-if="error && !data"
      variant="error"
      size="sm"
      class="dms-card"
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
    <DmsStatGroup
      v-else
      :items="items"
      :layout="layout"
      :loading="isLoading && !data"
      :skeleton-count="skeletonCount"
      :label="label ? processI18n(label) : undefined"
      :class="
        isLoading ? 'opacity-70 transition-opacity' : 'transition-opacity'
      "
    />
  </div>
</template>
