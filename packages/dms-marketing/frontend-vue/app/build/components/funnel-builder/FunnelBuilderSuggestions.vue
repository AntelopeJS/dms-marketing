<script setup lang="ts">
import { useI18n } from '#dms/frontend-module'
import type {
  MarketingFunnelStep,
  MarketingFunnelSuggestions,
} from '../../../composables/useMarketingApi'
import { formatNumber } from '../../../utils/format'

/** The suggestions card of `FunnelBuilder`: the pages and events the site sent most, each a step to add. */
defineProps<{
  addStep: (kind?: MarketingFunnelStep['kind'], value?: string) => void
  suggestions: MarketingFunnelSuggestions
}>()

const { t, locale } = useI18n()
</script>

<template>
  <section class="dms-card p-0">
    <header class="border-b border-default px-4 py-3">
      <DmsEyebrow :label="t('page.marketing.builder.events_title')" />
    </header>
    <ul class="divide-y divide-default">
      <li v-for="event in suggestions.events.slice(0, 6)" :key="event.value">
        <button
          type="button"
          class="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-elevated/60"
          :aria-label="
            t('page.marketing.builder.add_event_step', {
              name: event.value,
            })
          "
          @click="addStep('custom', event.value)"
        >
          <span class="flex-1 truncate font-mono text-[13px] text-highlighted">
            {{ event.value }}
          </span>
          <span class="font-mono text-[11px] text-dimmed">
            {{ formatNumber(event.count, locale) }}
          </span>
        </button>
      </li>
      <li
        v-if="suggestions.events.length === 0"
        class="px-4 py-4 text-center text-sm text-muted"
      >
        {{ t('page.marketing.builder.no_events') }}
      </li>
    </ul>
    <footer
      class="flex items-center gap-1.5 border-t border-default px-4 py-2.5 font-mono text-[11px] text-dimmed"
    >
      <UIcon name="i-ph-code" class="size-3.5 shrink-0" />
      <span class="min-w-0 break-words">
        {{ t('page.marketing.builder.events_hint') }}
      </span>
    </footer>
  </section>
</template>
