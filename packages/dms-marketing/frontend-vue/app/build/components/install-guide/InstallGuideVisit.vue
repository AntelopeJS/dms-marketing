<script setup lang="ts">
import { useI18n } from '#dms/frontend-module'
import type {
  MarketingConnectionStatus,
  MarketingConnectionVisit,
} from '../../../composables/useMarketingApi'
import type { ContextWebsite } from '../../../composables/useMarketingContext'

/** What the connection check of `InstallGuide` saw: the pageview that arrived, or the listening state while it waits for one. */
defineProps<{
  visit: MarketingConnectionVisit | null
  website: ContextWebsite
  status: MarketingConnectionStatus
  recheckSince: number | null
  siteUrl: string
  when: (at: number) => string
  checkAgain: () => void
  openOverview: () => Promise<void>
}>()

const { t } = useI18n()
</script>

<template>
  <div
    v-if="visit"
    class="flex flex-wrap items-center gap-4 rounded-lg border border-success/40 bg-success/10 p-4"
  >
    <DmsIconWell icon="i-ph-check" tone="success" />
    <span class="min-w-0 flex-1">
      <span class="block font-semibold text-highlighted">
        {{
          t('page.marketing.install.connected', {
            when: when(visit.at),
          })
        }}
      </span>
      <span class="block font-mono text-xs break-all text-muted">
        {{ visit.host ?? '' }}{{ visit.url }} · {{ visit.browser ?? '—' }} ·
        {{ visit.deviceType }}
      </span>
    </span>
    <span class="flex flex-wrap items-center gap-2">
      <UButton
        icon="i-ph-arrow-clockwise"
        color="neutral"
        variant="outline"
        :label="t('page.marketing.install.check_again')"
        @click="checkAgain"
      />
      <UButton
        trailing-icon="i-ph-arrow-right"
        :label="t('page.marketing.install.open_overview')"
        @click="openOverview"
      />
    </span>
  </div>
  <div
    v-else
    class="flex flex-wrap items-center gap-4 rounded-lg border border-dashed border-primary/50 bg-primary/5 p-4"
  >
    <span
      class="relative grid size-10 place-items-center rounded-full border border-primary/40 text-primary"
    >
      <UIcon name="i-ph-broadcast" class="size-5" />
      <span
        class="absolute inset-0 animate-ping rounded-full border border-primary/30"
      />
    </span>
    <span class="min-w-0 flex-1">
      <span class="block font-semibold break-words text-highlighted">
        {{
          t(
            recheckSince === null
              ? 'page.marketing.install.listening'
              : 'page.marketing.install.listening_again',
            { domain: website.domain },
          )
        }}
      </span>
      <span class="block text-xs text-muted">
        {{
          recheckSince === null
            ? t('page.marketing.install.listening_since', {
                when: when(status.createdAt),
              })
            : t('page.marketing.install.listening_again_since', {
                when: when(recheckSince),
              })
        }}
      </span>
    </span>
    <UButton
      v-if="siteUrl"
      icon="i-ph-arrow-square-out"
      color="neutral"
      variant="outline"
      :to="siteUrl"
      target="_blank"
      :label="t('page.marketing.install.open_site')"
    />
  </div>
</template>
