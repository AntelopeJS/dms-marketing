<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  useDmsRoute,
  useDmsRouter,
  useI18n,
} from '#dms/frontend-module'

interface TopListTabItem {
  id: string
  title: string
  value: number
  to?: { path: string, query?: Record<string, string> }
}

interface TopListTab {
  id: string
  label: string
  items: TopListTabItem[]
}

/**
 * One overview card holding sibling top lists behind pill tabs. The rows
 * mirror dms-ui's DmsTopListCard rendering, re-done locally because that
 * card carries its own DmsCard chrome and cannot nest inside another card.
 * A single tab renders as a plain list: no pill bar.
 */
const props = defineProps<{
  title: string
  tabs: TopListTab[]
  emptyLabel: string
  /** URL query key persisting the active tab; omit for free state. */
  stateKey?: string
  footerLabel?: string
  footerTo?: { path: string, query?: Record<string, string> }
}>()

const route = useDmsRoute()
const router = useDmsRouter()
const { locale } = useI18n()

const HIGHLIGHTED_RANKS = 3

const tabItems = computed(() =>
  props.tabs.map(tab => ({ label: tab.label, value: tab.id })))

function initialTab(): string {
  const wanted = props.stateKey ? route.query[props.stateKey] : undefined
  return typeof wanted === 'string' && props.tabs.some(tab => tab.id === wanted)
    ? wanted
    : (props.tabs[0]?.id ?? '')
}

const activeId = ref(initialTab())

// Conditional tabs (countries follows geoipEnabled, false until the fetch
// settles) can be missing at mount and appear later: adopt the tab the URL
// still asks for once it exists. The activeId watcher keeps the query in
// step with every manual pick, so re-reading it can never override one.
// The fallback covers the reverse: the active tab disappearing.
watch(() => props.tabs, (tabs) => {
  const wanted = props.stateKey ? route.query[props.stateKey] : undefined
  if (typeof wanted === 'string' && tabs.some(tab => tab.id === wanted)) {
    activeId.value = wanted
    return
  }
  if (!tabs.some(tab => tab.id === activeId.value)) {
    activeId.value = tabs[0]?.id ?? ''
  }
})

// Replace, not push: paging through tabs must not stack history entries.
// The default tab keeps the URL bare so a copied link stays minimal.
watch(activeId, (id) => {
  const key = props.stateKey
  if (!key) {
    return
  }
  const query = Object.fromEntries(
    Object.entries(route.query).filter(([name]) => name !== key),
  )
  if (id !== props.tabs[0]?.id) {
    query[key] = id
  }
  void router.replace({ query })
})

const activeTab = computed(() =>
  props.tabs.find(tab => tab.id === activeId.value) ?? props.tabs[0])

function rankClass(index: number): string {
  return index < HIGHLIGHTED_RANKS ? 'font-semibold text-primary' : 'text-muted'
}

function formatCount(value: number): string {
  return value.toLocaleString(locale.value)
}
</script>

<template>
  <!-- The grid stretches the cards of a row; the growing body soaks up the
       slack so every footer anchors to the bottom edge. -->
  <UCard class="flex flex-col" :ui="{ body: 'grow' }">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="font-medium">{{ title }}</p>
        <UTabs
          v-if="tabs.length > 1"
          v-model="activeId"
          :items="tabItems"
          :content="false"
          size="xs"
        />
      </div>
    </template>

    <!-- min-h holds the height of a full list — 8 rows of 2.5rem plus 7
         divide-y pixels — so switching to a shorter tab never jumps. -->
    <ul
      v-if="activeTab && activeTab.items.length > 0"
      class="grid min-h-[calc(20rem+7px)] content-start gap-x-3 divide-y divide-default [grid-template-columns:1.75rem_minmax(0,1fr)_auto]"
    >
      <li
        v-for="(item, index) in activeTab.items"
        :key="item.id"
        class="relative col-[1/-1] grid grid-cols-subgrid items-center py-2.5 transition-colors hover:bg-elevated/60"
        :class="item.to ? 'cursor-pointer' : ''"
      >
        <DmsLink
          v-if="item.to"
          :to="item.to"
          class="absolute inset-0 z-10"
          :aria-label="item.title"
        />
        <span
          class="text-center font-mono text-xs tabular-nums"
          :class="rankClass(index)"
        >
          {{ String(index + 1).padStart(2, '0') }}
        </span>
        <p class="min-w-0 truncate text-sm font-medium">{{ item.title }}</p>
        <span class="justify-self-end whitespace-nowrap text-xs tabular-nums text-muted">
          {{ formatCount(item.value) }}
        </span>
      </li>
    </ul>

    <div v-else class="flex min-h-[calc(20rem+7px)] items-center justify-center">
      <p class="text-sm text-muted">{{ emptyLabel }}</p>
    </div>

    <template v-if="footerLabel && footerTo" #footer>
      <DmsLink
        :to="footerTo"
        class="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-highlighted"
      >
        {{ footerLabel }}
        <UIcon name="i-ph-arrow-right" class="size-4" />
      </DmsLink>
    </template>
  </UCard>
</template>
