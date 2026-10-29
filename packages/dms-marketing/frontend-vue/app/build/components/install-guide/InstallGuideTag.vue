<script setup lang="ts">
import { useI18n } from '#dms/frontend-module'
import type { ContextWebsite } from '../../../composables/useMarketingContext'

/** Step 2 of `InstallGuide`: the tag to paste, and the options it takes. */
defineProps<{
  stepTwoState: 'done' | 'current' | 'next'
  website: ContextWebsite | null
}>()

const { t } = useI18n()
</script>

<template>
  <li class="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 pb-6">
    <span class="flex flex-col items-center">
      <span
        class="grid size-8 place-items-center rounded-full border font-mono text-xs"
        :class="
          stepTwoState === 'done'
            ? 'border-primary/40 text-primary'
            : stepTwoState === 'current'
              ? 'border-primary bg-primary text-inverted ring-4 ring-primary/20'
              : 'border-default text-dimmed'
        "
      >
        <UIcon
          v-if="stepTwoState === 'done'"
          name="i-ph-check"
          class="size-4"
        />
        <template v-else>2</template>
      </span>
      <span class="mt-2 w-px flex-1 bg-(--ui-border)" />
    </span>
    <div class="flex min-w-0 flex-col gap-3">
      <h2
        class="font-semibold"
        :class="website ? 'text-highlighted' : 'text-muted'"
      >
        {{ t('page.marketing.install.step2') }}
      </h2>
      <p class="text-sm text-muted">
        {{ t('page.marketing.install.step2_description') }}
      </p>
      <DmsMarketingTrackerSnippet v-if="website" :website-id="website.id" />
      <UCollapsible v-if="website" class="rounded-lg border border-default">
        <UButton
          color="neutral"
          variant="ghost"
          block
          class="justify-start"
          icon="i-ph-sliders-horizontal"
          trailing-icon="i-ph-caret-down"
        >
          <span class="font-medium">
            {{ t('page.marketing.install.options') }}
          </span>
          <span class="text-xs text-dimmed">
            {{ t('page.marketing.install.options_hint') }}
          </span>
        </UButton>
        <template #content>
          <dl
            class="grid grid-cols-[12rem_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 pb-4 text-sm"
          >
            <dt class="font-mono text-xs text-highlighted">
              data-heatmap-sample
            </dt>
            <dd class="text-muted">
              {{ t('page.marketing.install.option_sample') }}
            </dd>
            <dt class="font-mono text-xs text-highlighted">
              data-do-not-track
            </dt>
            <dd class="text-muted">
              {{ t('page.marketing.install.option_dnt') }}
            </dd>
            <dt class="font-mono text-xs text-highlighted">
              data-host-url
            </dt>
            <dd class="text-muted">
              {{ t('page.marketing.install.option_host') }}
            </dd>
          </dl>
        </template>
      </UCollapsible>
    </div>
  </li>
</template>
