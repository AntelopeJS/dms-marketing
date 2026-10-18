<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '#dms/frontend-module'
import type { MarketingWorkspace } from '../composables/useMarketingApi'
import { installLink } from '../composables/useMarketingRoutes'
import { initials } from '../utils/format'
import type {
  WebsitePickerItem,
  WebsitePickerState,
} from '../utils/website-picker'

/**
 * The head of the Pages & heatmaps list: what the list reads. The website
 * picker and its compact state on one row, the workspace selector (a
 * platform owner on the dashboard's own website) on the next, its read-only
 * note under it.
 *
 * Self-contained: the rows and the state come in ready to show, the picks go
 * out as events, so it holds whichever bar the page sits under. `website`
 * null leaves the picker to the bar; `workspace` null, or a single option,
 * shows no selector. With neither, the parent renders nothing.
 */
const props = defineProps<{
  website: {
    items: WebsitePickerItem[]
    selectedId: string
    switching?: boolean
  } | null
  state: WebsitePickerState | null
  workspace: {
    options: MarketingWorkspace[]
    /** `''` own workspace, `all`, or another workspace's id. */
    value: string
  } | null
}>()

const emit = defineEmits<{
  'select-website': [id: string]
  'select-workspace': [workspace: string]
}>()

const { t } = useI18n()

const selected = computed(
  () =>
    props.website?.items.find(
      (item) => item.id === props.website?.selectedId,
    ) ?? null,
)

const menuItems = computed(() => [
  (props.website?.items ?? []).map((site) => ({
    label: site.name,
    description: site.domain,
    type: 'checkbox' as const,
    checked: site.id === props.website?.selectedId,
    slot: 'website' as const,
    site,
    onSelect: () => emit('select-website', site.id),
  })),
  [
    {
      label: t('page.marketing.context.add_website'),
      icon: 'i-ph-plus',
      to: installLink(),
    },
  ],
])

const showsWorkspace = computed(
  () => (props.workspace?.options.length ?? 0) > 1,
)
</script>

<template>
  <div
    v-if="selected || showsWorkspace"
    class="flex min-w-0 flex-col gap-2 border-b border-default p-3"
    role="group"
    :aria-label="t('page.marketing.pages.panel_header')"
  >
    <div v-if="selected" class="flex min-w-0 items-center gap-2">
      <UDropdownMenu :items="menuItems" :content="{ align: 'start' }">
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          trailing-icon="i-ph-caret-up-down"
          class="min-w-0 max-w-full"
          :loading="website?.switching"
          :aria-label="t('page.marketing.context.switch_website')"
        >
          <span
            class="grid size-5 shrink-0 place-items-center rounded bg-primary/15 font-mono text-[10px] font-semibold text-(--ui-color-primary-800) dark:text-primary"
          >
            {{ initials(selected.name) }}
          </span>
          <span class="truncate font-semibold">{{ selected.name }}</span>
        </UButton>
        <template #website="{ item }">
          <span
            class="grid size-6 shrink-0 place-items-center rounded bg-primary/15 font-mono text-[10px] font-semibold text-(--ui-color-primary-800) dark:text-primary"
          >
            {{ initials(item.site.name) }}
          </span>
          <span class="min-w-0 flex-1 text-left">
            <span class="block truncate text-sm font-medium text-highlighted">
              {{ item.site.name }}
            </span>
            <span class="flex min-w-0 items-center gap-1.5 text-xs text-dimmed">
              <span
                class="size-1.5 shrink-0 rounded-full"
                :class="item.site.dot"
                aria-hidden="true"
              />
              <span class="truncate font-mono">{{ item.site.domain }}</span>
              <span class="shrink-0">· {{ item.site.line }}</span>
            </span>
          </span>
          <UIcon
            v-if="item.checked"
            name="i-ph-check"
            class="size-4 shrink-0 text-primary"
          />
        </template>
      </UDropdownMenu>

      <UTooltip v-if="state" :text="state.hint">
        <span
          class="flex min-w-0 items-center gap-1.5 text-xs text-muted tabular-nums"
          role="status"
          tabindex="0"
          :aria-label="state.hint"
        >
          <span
            class="size-2 shrink-0 rounded-full"
            :class="state.dot"
            aria-hidden="true"
          />
          <span class="truncate" aria-hidden="true">{{ state.label }}</span>
        </span>
      </UTooltip>
    </div>

    <DmsMarketingWorkspaceScope
      v-if="workspace && showsWorkspace"
      :workspaces="workspace.options"
      :model-value="workspace.value"
      @update:model-value="emit('select-workspace', $event)"
    />
  </div>
</template>
