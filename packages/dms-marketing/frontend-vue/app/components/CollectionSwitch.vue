<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from '#dms/frontend-module'
import {
  useMarketingApi,
  type MarketingCollectionStatus,
} from '../composables/useMarketingApi'
import { formatNumber } from '../utils/format'

/**
 * The master switch of collection, apart from the form: a status line and a
 * "Pause collection…" action that says what pausing stops before it does.
 */
const props = withDefaults(
  defineProps<{ fetchUrl?: string; componentId?: string; pageId?: string }>(),
  { fetchUrl: undefined, componentId: undefined, pageId: undefined },
)

void props

const { t, locale } = useI18n()
const api = useMarketingApi()
const toast = useToast()
const { confirm } = useConfirm()

const status = ref<MarketingCollectionStatus | null>(null)
const failed = ref(false)

async function load(): Promise<void> {
  try {
    status.value = await api.getCollection()
    failed.value = false
  } catch {
    failed.value = true
  }
}

onMounted(load)

async function write(enabled: boolean): Promise<void> {
  status.value = await api.setCollection(enabled)
  toast.add({
    color: enabled ? 'success' : 'warning',
    title: t(
      enabled
        ? 'page.marketing.settings.collection.resumed'
        : 'page.marketing.settings.collection.paused_toast',
    ),
  })
}

async function pause(): Promise<void> {
  await confirm({
    title: t('page.marketing.settings.collection.pause_title'),
    description: t('page.marketing.settings.collection.pause_description'),
    color: 'error',
    icon: 'i-ph-pause',
    confirmLabel: t('page.marketing.settings.collection.pause_confirm'),
    impact: [
      {
        icon: 'i-ph-code',
        label: t('page.marketing.settings.collection.impact_script'),
      },
      {
        icon: 'i-ph-flask',
        label: t('page.marketing.settings.collection.impact_tests'),
      },
      {
        icon: 'i-ph-clock',
        label: t('page.marketing.settings.collection.impact_delay'),
      },
    ],
    onConfirm: () => write(false),
  })
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-3 px-4 py-3">
    <USkeleton v-if="!status && !failed" class="h-6 w-64" />
    <span v-else-if="failed" class="text-sm text-error">
      {{ t('page.marketing.common.load_error') }}
    </span>
    <template v-else-if="status">
      <DmsStatusPill
        :tone="status.enabled ? 'success' : 'warning'"
        :dot="status.enabled ? 'pulse' : 'static'"
        :label="
          t(
            status.enabled
              ? 'page.marketing.settings.collection.collecting'
              : 'page.marketing.settings.collection.paused',
          )
        "
      />
      <span class="text-sm text-muted">
        {{
          t('page.marketing.settings.collection.summary', {
            websites: status.websites,
            sessions: formatNumber(status.sessions, locale),
          })
        }}
      </span>
      <UButton
        v-if="status.enabled"
        class="ms-auto"
        color="error"
        variant="outline"
        size="sm"
        icon="i-ph-pause"
        :label="t('page.marketing.settings.collection.pause')"
        @click="pause"
      />
      <UButton
        v-else
        class="ms-auto"
        color="success"
        size="sm"
        icon="i-ph-play"
        :label="t('page.marketing.settings.collection.resume')"
        @click="write(true)"
      />
    </template>
  </div>
</template>
