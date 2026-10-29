<script setup lang="ts">
import { useI18n } from '#dms/frontend-module'
import type { MarketingFunnelResults } from '../../../composables/useMarketingApi'
import {
  funnelBuilderLink,
  pagesLink,
} from '../../../composables/useMarketingRoutes'
import { fractionDigits } from '../../../constants'

/** The "where to look next" card of `FunnelFigure`: the step losing the largest share and the first drop worth a split. */
defineProps<{
  noTraffic: boolean
  worst: { index: number; lost: number; rate: number } | null
  firstDrop: { index: number; lost: number; rate: number } | null
  steps: MarketingFunnelResults['computation']['steps']
  unseen: string[]
  entered: number
  definition: MarketingFunnelResults['funnel']
  stepLabel: (index: number) => string
  inContext: (link: string) => string
}>()

const { t, locale } = useI18n()
</script>

<template>
  <section v-if="!noTraffic" class="dms-card p-0">
    <header class="border-b border-default px-4 py-3">
      <DmsEyebrow :label="t('page.marketing.funnel.next.title')" />
    </header>
    <ul class="divide-y divide-default">
      <li v-if="worst" class="flex items-start gap-3 px-4 py-3">
        <DmsIconWell icon="i-ph-browser" tone="error" size="sm" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-medium text-highlighted">
            {{
              t('page.marketing.funnel.next.worst', {
                rate: formatPercentage(
                  worst.rate / 100,
                  locale,
                  fractionDigits(1),
                ),
                step: stepLabel(worst.index),
              })
            }}
          </span>
          <span class="block text-xs text-muted">
            {{ t('page.marketing.funnel.next.worst_hint') }}
          </span>
        </span>
        <DmsAutoLink
          v-if="steps[worst.index]?.step.kind === 'url'"
          :to="inContext(pagesLink(stepLabel(worst.index)))"
          class="font-mono text-xs text-primary hover:underline"
        >
          {{ t('page.marketing.funnel.next.heatmap') }}
        </DmsAutoLink>
      </li>
      <li v-if="firstDrop" class="flex items-start gap-3 px-4 py-3">
        <DmsIconWell icon="i-ph-flask" tone="warning" size="sm" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-medium text-highlighted">
            {{
              t('page.marketing.funnel.next.first', {
                rate: formatPercentage(
                  firstDrop.rate / 100,
                  locale,
                  fractionDigits(1),
                ),
                step: stepLabel(1),
              })
            }}
          </span>
          <span class="block text-xs text-muted">
            {{
              t('page.marketing.funnel.next.first_hint', {
                step: stepLabel(0),
              })
            }}
          </span>
        </span>
        <DmsAutoLink
          :to="inContext(funnelBuilderLink(definition._id, { split: true }))"
          class="font-mono text-xs text-primary hover:underline"
        >
          {{ t('page.marketing.funnel.next.split') }}
        </DmsAutoLink>
      </li>
      <li v-if="!worst" class="px-4 py-6 text-center text-sm text-muted">
        {{
          t(
            unseen.length > 0
              ? 'page.marketing.funnel.next.unseen'
              : entered === 0
                ? 'page.marketing.funnel.next.nobody'
                : 'page.marketing.funnel.next.none',
          )
        }}
      </li>
    </ul>
  </section>
</template>
