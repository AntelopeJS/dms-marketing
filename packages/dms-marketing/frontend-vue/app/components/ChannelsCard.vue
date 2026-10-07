<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '#dms/frontend-module'
import { channelStyle } from '../utils/channels'
import { formatNumber, formatPercent } from '../utils/format'

/**
 * The channel split of the period: a stacked share bar, then one row per
 * channel with its sessions, share and change vs the comparison window.
 */
interface ChannelRow {
  id: string
  sessions: number
  share: number
  delta: number | null
}

interface ChannelsResponse {
  total: number
  items: ChannelRow[]
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

const SKELETON_ROWS = 6
const NEW_CHANNEL = 'email'

const { t, locale } = useI18n()

const { data, isLoading, error, refresh } = useChartFetch<ChannelsResponse>({
  fetchUrl: props.fetchUrl,
  periodScope: props.periodScope,
})

const rows = computed(() => data.value?.items ?? [])
const maxShare = computed(() =>
  Math.max(1, ...rows.value.map((row) => row.share)),
)

function deltaClass(delta: number | null): string {
  if (delta === null || Math.abs(delta) < 0.05) {
    return 'bg-elevated text-muted'
  }
  return delta > 0 ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
}

function deltaLabel(delta: number | null): string {
  if (delta === null) {
    return '—'
  }
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±'
  return `${sign}${formatPercent(Math.abs(delta), locale.value)}`
}
</script>

<template>
  <section class="dms-card flex h-full flex-col overflow-hidden p-0">
    <header class="flex items-center gap-4 border-b border-default px-4 py-3">
      <DmsEyebrow
        :label="
          t('page.marketing.acquisition.channels.title', {
            count: formatNumber(data?.total ?? 0, locale),
          })
        "
      />
      <div
        v-if="data && data.total > 0"
        class="ms-auto flex h-2 w-56 overflow-hidden rounded-full bg-elevated"
        aria-hidden="true"
      >
        <span
          v-for="row in rows"
          :key="row.id"
          class="h-full"
          :class="channelStyle(row.id).bar"
          :style="{ width: `${row.share}%` }"
        />
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

    <table v-else class="w-full text-sm">
      <thead>
        <tr
          class="text-left font-mono text-[10px] tracking-widest text-dimmed uppercase"
        >
          <th class="px-4 py-2 font-normal" colspan="2">
            {{ t('page.marketing.acquisition.channels.channel') }}
          </th>
          <th class="px-2 py-2 text-right font-normal">
            {{ t('page.marketing.acquisition.channels.sessions') }}
          </th>
          <th class="px-2 py-2 text-right font-normal">
            {{ t('page.marketing.acquisition.channels.share') }}
          </th>
          <th class="px-4 py-2 text-right font-normal">
            {{ t('page.marketing.acquisition.channels.vs_previous') }}
          </th>
        </tr>
      </thead>
      <tbody v-if="isLoading && !data" aria-hidden="true">
        <tr
          v-for="index in SKELETON_ROWS"
          :key="index"
          class="border-t border-default"
        >
          <td class="px-4 py-3" colspan="5">
            <USkeleton class="h-4 w-full" />
          </td>
        </tr>
      </tbody>
      <tbody v-else :class="isLoading ? 'opacity-60' : ''">
        <tr v-for="row in rows" :key="row.id" class="border-t border-default">
          <td class="w-10 py-2.5 ps-4">
            <DmsIconWell
              :icon="channelStyle(row.id).icon"
              size="sm"
              tone="muted"
            />
          </td>
          <td class="px-2 py-2.5">
            <div class="flex items-center gap-4">
              <span
                class="flex w-36 shrink-0 items-center gap-2 font-medium text-highlighted"
              >
                {{ t(`page.marketing.channels.${row.id}`) }}
                <DmsStatusPill
                  v-if="row.id === NEW_CHANNEL"
                  tone="primary"
                  size="sm"
                  :label="t('page.marketing.common.new')"
                />
              </span>
              <span
                class="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-elevated sm:block"
              >
                <span
                  class="block h-full rounded-full"
                  :class="channelStyle(row.id).bar"
                  :style="{ width: `${(row.share / maxShare) * 100}%` }"
                />
              </span>
            </div>
          </td>
          <td
            class="px-2 py-2.5 text-right font-mono tabular-nums text-highlighted"
          >
            {{ formatNumber(row.sessions, locale) }}
          </td>
          <td
            class="px-2 py-2.5 text-right font-mono font-semibold tabular-nums text-highlighted"
          >
            {{ formatPercent(row.share, locale) }}
          </td>
          <td class="px-4 py-2.5 text-right">
            <span
              class="rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums"
              :class="deltaClass(row.delta)"
            >
              {{ deltaLabel(row.delta) }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
