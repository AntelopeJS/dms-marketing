<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from '#dms/frontend-module'
import type { MarketingWorkspace } from '../composables/useMarketingApi'
import { ALL_WORKSPACES } from '../utils/workspace-scope'

/**
 * Whose dashboard the heatmaps read: the viewer's workspace, another one,
 * or all of them combined (see utils/workspace-scope). Self-contained — the
 * options in, the scope out through `v-model` — so it can sit wherever the
 * view's website context sits: the top of the pages panel, above its search.
 * Outside the viewer's workspace its note (combined, read-only, masked) sits
 * in the tooltip of an info icon beside it, keyboard focusable and
 * describing the selector, so the row stays compact. The parent renders it
 * only when the backend offers two workspaces or more: never to a workspace
 * owner.
 */
const props = defineProps<{
  workspaces: MarketingWorkspace[]
  /** `''` own workspace, `all`, or another workspace's id. */
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [workspace: string]
}>()

const { t } = useI18n()
const noteId = useId()

const own = computed(() => props.workspaces.find((option) => option.current))

const label = computed(() => {
  if (props.modelValue === ALL_WORKSPACES) {
    return t('page.marketing.pages.workspace.all')
  }
  const picked = props.workspaces.find(
    (option) => option.id === props.modelValue,
  )
  return (picked ?? own.value)?.name ?? ''
})

const items = computed(() => [
  [
    {
      label: t('page.marketing.pages.workspace.all'),
      description: t(
        'page.marketing.pages.workspace.all_hint',
        { count: props.workspaces.length },
        props.workspaces.length,
      ),
      icon: 'i-ph-stack',
      type: 'checkbox' as const,
      checked: props.modelValue === ALL_WORKSPACES,
      onSelect: () => emit('update:modelValue', ALL_WORKSPACES),
    },
  ],
  props.workspaces.map((option) => ({
    label: option.name,
    description: option.current
      ? t('page.marketing.pages.workspace.yours')
      : undefined,
    icon: 'i-ph-buildings',
    type: 'checkbox' as const,
    checked: option.current
      ? !props.modelValue
      : props.modelValue === option.id,
    onSelect: () => emit('update:modelValue', option.current ? '' : option.id),
  })),
])

/** Outside the viewer's own workspace, what the view shows differs: said. */
const note = computed(() => {
  if (!props.modelValue) {
    return ''
  }
  return props.modelValue === ALL_WORKSPACES
    ? t(
        'page.marketing.pages.workspace.combined_note',
        { count: props.workspaces.length },
        props.workspaces.length,
      )
    : t('page.marketing.pages.workspace.other_note')
})
</script>

<template>
  <div class="flex min-w-0 items-center gap-1.5">
    <UDropdownMenu :items="items" :content="{ align: 'start' }">
      <UButton
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-ph-buildings"
        trailing-icon="i-ph-caret-up-down"
        class="min-w-0 max-w-full"
        :aria-label="t('page.marketing.pages.workspace.switch')"
        :aria-describedby="note ? noteId : undefined"
      >
        <span class="shrink-0 text-muted">
          {{ t('page.marketing.pages.workspace.label') }}
        </span>
        <span class="truncate font-semibold">{{ label }}</span>
      </UButton>
    </UDropdownMenu>
    <UTooltip v-if="note" :text="note">
      <span
        class="grid size-6 shrink-0 place-items-center rounded text-muted hover:text-default focus-visible:outline-2 focus-visible:outline-primary"
        tabindex="0"
        role="img"
        :aria-label="t('page.marketing.pages.workspace.note_label')"
        :aria-describedby="noteId"
      >
        <UIcon name="i-ph-info" class="size-4" aria-hidden="true" />
      </span>
    </UTooltip>
    <span v-if="note" :id="noteId" class="sr-only">{{ note }}</span>
  </div>
</template>
