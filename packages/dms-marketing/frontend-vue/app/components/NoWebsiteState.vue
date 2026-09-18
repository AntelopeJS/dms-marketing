<script setup lang="ts">
import { useI18n } from '#dms/frontend-module'

defineProps<{ icon: string, title: string, description: string }>()
const emit = defineEmits<{ create: [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col items-start gap-3">
    <UAlert :icon="icon" :title="title" :description="description" />
    <UButton
      icon="i-ph-plus"
      :label="t('page.marketing.websites.create')"
      @click="emit('create')"
    />
  </div>
</template>
