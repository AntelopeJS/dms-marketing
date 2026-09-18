<script setup lang="ts">
import { computed } from 'vue'
import { useDmsRuntimeConfig, useI18n } from '#dms/frontend-module'
import type { MarketingWebsite } from '../composables/useMarketingApi'

const props = defineProps<{ website: MarketingWebsite }>()
const { t } = useI18n()
const config = useDmsRuntimeConfig()

const backendOrigin = computed(() =>
  String((config.public as { dms?: { baseURL?: string } }).dms?.baseURL ?? ''),
)

const CLOSING_TAG = '</' + 'script>'

const snippet = computed(() =>
  `<script defer src="${backendOrigin.value}/api/marketing/tracker.js" data-website-id="${props.website._id}">${CLOSING_TAG}`,
)
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-muted">
      {{ t('page.marketing.websites.snippet.description', { name: website.name }) }}
    </p>
    <div class="flex items-start gap-2 rounded-lg bg-elevated p-3">
      <pre class="min-w-0 flex-1 overflow-x-auto text-xs"><code>{{ snippet }}</code></pre>
      <DmsCopyButton :value="snippet" />
    </div>
  </div>
</template>
