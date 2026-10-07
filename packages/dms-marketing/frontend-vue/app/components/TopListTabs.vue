<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '#dms/frontend-module'
import { displayName, formatNumber, formatPercent } from '../utils/format'

/**
 * One overview card holding sibling top lists behind tabs (top pages, entry,
 * exit…), read in one request that follows the period scope. Each row shows
 * its rank, a bar of its share, the count and the share; rows lead to the
 * surface that owns them.
 */
type LabelKind = 'raw' | 'channel' | 'country' | 'language' | 'device'

interface TopRow {
  id: string
  title: string
  value: number
  share: number
  to?: string
  tag?: string
}

interface TopTab {
  id: string
  label: string
  labelKind: LabelKind
  total: number
  items: TopRow[]
}

interface TopTabsResponse {
  tabs: TopTab[]
}

const props = withDefaults(
  defineProps<{
    fetchUrl: string
    periodScope?: string
    eyebrow: string
    valueLabel: string
    note?: string
    footerLabel?: string
    footerTo?: string
    componentId?: string
    pageId?: string
  }>(),
  {
    periodScope: undefined,
    note: undefined,
    footerLabel: undefined,
    footerTo: undefined,
    componentId: undefined,
    pageId: undefined,
  },
)

const HIGHLIGHTED_RANKS = 3
const SKELETON_ROWS = 6
const RANK_DIGITS = 2

const { t, te, locale } = useI18n()
const { processI18n } = useTranslation()

const { data, isLoading, error, refresh } = useChartFetch<TopTabsResponse>({
  fetchUrl: props.fetchUrl,
  periodScope: props.periodScope,
})

const tabs = computed(() => data.value?.tabs ?? [])
const activeId = ref<string>('')

watch(
  tabs,
  (list) => {
    if (!list.some((tab) => tab.id === activeId.value)) {
      activeId.value = list[0]?.id ?? ''
    }
  },
  { immediate: true },
)

const active = computed(
  () => tabs.value.find((tab) => tab.id === activeId.value) ?? null,
)
const maxShare = computed(() =>
  Math.max(1, ...(active.value?.items.map((item) => item.share) ?? [])),
)

const LABELERS: Record<LabelKind, (key: string) => string> = {
  raw: (key) => key,
  channel: (key) => {
    const i18nKey = `page.marketing.channels.${key}`
    return te(i18nKey) ? t(i18nKey) : key
  },
  country: (key) => displayName(key, 'region', locale.value),
  language: (key) => displayName(key, 'language', locale.value),
  device: (key) => t(`page.marketing.devices.${key}`),
}

const MONO_KINDS = new Set<LabelKind>(['raw'])

function rank(index: number): string {
  return String(index + 1).padStart(RANK_DIGITS, '0')
}
</script>

<template>
  <section class="dms-card flex min-w-0 flex-col overflow-hidden p-0">
    <header class="flex items-center gap-4 border-b border-default px-4">
      <DmsEyebrow :label="processI18n(eyebrow)" class="shrink-0 py-3" />
      <div
        class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        role="tablist"
      >
        <button
          v-for="tab in tabs.length > 1 ? tabs : []"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="tab.id === activeId"
          class="relative px-2 py-3 text-[13px] whitespace-nowrap transition-colors"
          :class="
            tab.id === activeId
              ? 'font-semibold text-highlighted after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
              : 'text-muted hover:text-highlighted'
          "
          @click="activeId = tab.id"
        >
          {{ processI18n(tab.label) }}
        </button>
      </div>
      <DmsEyebrow :label="processI18n(valueLabel)" class="shrink-0 py-3" />
    </header>

    <div class="flex-1">
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
      <ul
        v-else-if="isLoading && !data"
        class="divide-y divide-default"
        aria-hidden="true"
      >
        <li
          v-for="index in SKELETON_ROWS"
          :key="index"
          class="flex items-center gap-3 px-4 py-3"
        >
          <USkeleton class="h-3 w-5" />
          <USkeleton class="h-3 flex-1" />
          <USkeleton class="h-3 w-12" />
        </li>
      </ul>
      <p
        v-else-if="!active || active.items.length === 0"
        class="px-4 py-10 text-center text-sm text-muted"
      >
        {{ t('page.marketing.overview.groups.empty') }}
      </p>
      <ol
        v-else
        class="divide-y divide-default transition-opacity"
        :class="isLoading ? 'opacity-60' : ''"
      >
        <li v-for="(item, index) in active.items" :key="item.id">
          <component
            :is="item.to ? 'DmsAutoLink' : 'div'"
            :to="item.to"
            class="grid grid-cols-[1.75rem_minmax(0,1fr)_auto_3.5rem] items-center gap-x-3 px-4 py-2"
            :class="item.to ? 'transition-colors hover:bg-elevated/60' : ''"
          >
            <span
              class="font-mono text-[11px]"
              :class="
                index < HIGHLIGHTED_RANKS
                  ? 'font-semibold text-primary'
                  : 'text-dimmed'
              "
            >
              {{ rank(index) }}
            </span>
            <span class="min-w-0">
              <span class="flex min-w-0 items-center gap-2">
                <span
                  class="truncate text-[13px] text-highlighted"
                  :class="MONO_KINDS.has(active.labelKind) ? 'font-mono' : ''"
                >
                  {{ LABELERS[active.labelKind](item.title) }}
                </span>
                <DmsStatusPill
                  v-if="item.tag"
                  tone="primary"
                  size="sm"
                  :mono="false"
                  icon="i-ph-flag-checkered"
                  :label="processI18n(item.tag)"
                />
              </span>
              <span
                class="mt-1 block h-0.5 rounded-full bg-primary/70"
                :style="{ width: `${(item.share / maxShare) * 100}%` }"
              />
            </span>
            <span class="font-mono text-[13px] text-highlighted tabular-nums">
              {{ formatNumber(item.value, locale) }}
            </span>
            <span
              class="text-right font-mono text-[11px] text-dimmed tabular-nums"
            >
              {{ formatPercent(item.share, locale) }}
            </span>
          </component>
        </li>
      </ol>
    </div>

    <footer
      v-if="footerTo || note"
      class="flex items-center justify-between gap-3 border-t border-default px-4 py-2.5 text-xs"
    >
      <DmsAutoLink
        v-if="footerTo && footerLabel"
        :to="footerTo"
        class="inline-flex items-center gap-1 font-medium text-primary hover:underline"
      >
        {{ processI18n(footerLabel) }}
        <UIcon name="i-ph-arrow-right" class="size-3.5" />
      </DmsAutoLink>
      <span v-if="note" class="truncate text-dimmed">
        {{ processI18n(note) }}
      </span>
    </footer>
  </section>
</template>
