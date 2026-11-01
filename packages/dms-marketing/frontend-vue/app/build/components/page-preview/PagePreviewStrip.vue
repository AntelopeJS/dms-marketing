<script setup lang="ts">
import { useI18n } from '#dms/frontend-module'
import type { StatusStrip } from '../../types/pagePreview'

/** The status strip of `PagePreview`: the one state above the snapshot worth telling, with its actions. */
defineProps<{
  statusStrip: StatusStrip
  savingOptions: boolean
}>()

const { t } = useI18n()
</script>

<template>
  <div class="px-3 pt-3">
    <DmsBanner
      :tone="statusStrip.tone"
      size="sm"
      :icon="statusStrip.icon"
      :title="statusStrip.title"
      :description="statusStrip.description"
      :dismissible="!!statusStrip.dismiss"
      @dismiss="statusStrip.dismiss?.()"
    >
      <template v-if="statusStrip.details" #description>
        <UPopover :content="{ align: 'start' }">
          <UButton
            icon="i-ph-info"
            size="xs"
            color="neutral"
            variant="ghost"
            class="-my-1 align-middle"
            :aria-label="t('page.marketing.pages.preview.strip_details')"
          />
          <template #content>
            <p class="max-w-sm p-3 text-xs leading-relaxed text-muted">
              {{ statusStrip.details }}
            </p>
          </template>
        </UPopover>
      </template>
      <template v-if="statusStrip.action || statusStrip.secondary" #actions>
        <UButton
          v-if="statusStrip.action"
          size="xs"
          color="neutral"
          variant="outline"
          :loading="savingOptions"
          :label="statusStrip.action.label"
          :to="statusStrip.action.to"
          @click="statusStrip.action.run?.()"
        />
        <UButton
          v-if="statusStrip.secondary"
          size="xs"
          color="neutral"
          variant="ghost"
          :label="statusStrip.secondary.label"
          :to="statusStrip.secondary.to"
          @click="statusStrip.secondary.run?.()"
        />
      </template>
    </DmsBanner>
  </div>
</template>
