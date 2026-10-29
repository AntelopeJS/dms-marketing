<script setup lang="ts">
import { useI18n } from '#dms/frontend-module'
import type { MarketingFunnelResults } from '../../../composables/useMarketingApi'
import { funnelBuilderLink } from '../../../composables/useMarketingRoutes'

/** The definition card of `FunnelFigure`: the website, the steps and the conversion window, with a link to edit them. */
defineProps<{
  noTraffic: boolean
  definition: MarketingFunnelResults['funnel']
  websiteName: string
  windowHours: number
  inContext: (link: string) => string
}>()

const { t } = useI18n()
</script>

<template>
  <section class="dms-card p-0" :class="noTraffic ? 'lg:col-span-2' : ''">
    <header
      class="flex items-center justify-between border-b border-default px-4 py-3"
    >
      <DmsEyebrow :label="t('page.marketing.funnel.definition.title')" />
      <DmsAutoLink
        :to="inContext(funnelBuilderLink(definition._id))"
        class="text-xs font-medium text-primary hover:underline"
      >
        {{ t('page.marketing.common.edit') }}
      </DmsAutoLink>
    </header>
    <dl
      class="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-3 px-4 py-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]"
    >
      <dt class="text-muted">
        {{ t('page.marketing.funnel.definition.website') }}
      </dt>
      <dd class="text-highlighted">{{ websiteName || '—' }}</dd>
      <dt class="text-muted">
        {{ t('page.marketing.funnel.definition.steps') }}
      </dt>
      <dd class="flex flex-wrap items-center gap-1">
        <template v-for="(step, index) in definition.steps" :key="index">
          <UIcon
            v-if="index > 0"
            name="i-ph-caret-right"
            class="size-3 text-dimmed"
          />
          <span
            class="max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-[11px]"
            :class="
              step.kind === 'custom'
                ? 'border-primary/40 text-primary'
                : 'border-default text-toned'
            "
          >
            {{ step.value }}
          </span>
        </template>
      </dd>
      <dt class="text-muted">
        {{ t('page.marketing.funnel.definition.window') }}
      </dt>
      <dd class="text-highlighted">
        {{
          t('page.marketing.funnel.definition.window_value', {
            hours: windowHours,
          })
        }}
      </dd>
    </dl>
  </section>
</template>
