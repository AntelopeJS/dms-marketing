<script setup lang="ts">
import { useI18n } from '#dms/frontend-module'
import type { MarketingFunnelListItem } from '../../../composables/useMarketingApi'
import { funnelLink } from '../../../composables/useMarketingRoutes'
import { formatNumber } from '../../../utils/format'
import { heatLegendGradient } from '../../../utils/heatmapPalette'
import type { ClickedElement } from '../../types/pagePreview'

/** The side panel of `PagePreview`: the legend of the overlay on screen, the most clicked elements or the scroll depth, and the funnels the page is a step of. */
defineProps<{
  filled: boolean
  overlayMode: 'clicks' | 'scroll'
  mostClicked: ClickedElement[]
  medianDepth: number
  scrollFoldRatio: number
  scrollViews: number
  usedIn: MarketingFunnelListItem[] | undefined
}>()

const { t, locale } = useI18n()
</script>

<template>
  <aside
    class="flex flex-col gap-4 border-t border-default p-4 xl:border-t-0 xl:border-l"
    :class="filled ? 'min-h-0 overflow-y-auto' : ''"
  >
    <template v-if="overlayMode === 'clicks'">
      <div class="flex flex-col gap-1.5">
        <DmsEyebrow :label="t('page.marketing.pages.density')" />
        <span
          class="h-2 rounded-full"
          :style="{ backgroundImage: heatLegendGradient() }"
        />
        <span class="flex justify-between text-[10px] text-dimmed">
          <span>{{ t('page.marketing.pages.density_few') }}</span>
          <span>{{ t('page.marketing.pages.density_many') }}</span>
        </span>
      </div>
      <div class="flex flex-col gap-2">
        <DmsEyebrow :label="t('page.marketing.pages.most_clicked')" />
        <p v-if="mostClicked.length === 0" class="text-xs text-muted">
          {{ t('page.marketing.pages.most_clicked_empty') }}
        </p>
        <ul v-else class="flex flex-col gap-2.5">
          <li
            v-for="element in mostClicked"
            :key="element.key"
            class="flex min-w-0 flex-col"
          >
            <span class="flex items-start justify-between gap-2">
              <span
                class="truncate text-[13px] font-medium text-highlighted"
                :class="element.text ? '' : 'font-mono'"
                :title="element.text || element.selector"
              >
                {{
                  element.text
                    ? t('page.marketing.pages.quoted', {
                        text: element.text,
                      })
                    : element.selector
                }}
              </span>
              <span class="font-mono text-xs text-highlighted">
                {{ formatNumber(element.weight, locale) }}
              </span>
            </span>
            <span
              v-if="element.text"
              class="truncate font-mono text-[10px] text-dimmed"
              :title="element.selector"
            >
              {{ element.selector }}
            </span>
          </li>
        </ul>
      </div>
    </template>
    <div v-else class="flex flex-col gap-2">
      <DmsEyebrow :label="t('page.marketing.pages.scroll.legend_title')" />
      <span
        class="h-2 rounded-full"
        :style="{ backgroundImage: heatLegendGradient(true) }"
      />
      <span class="flex justify-between text-[10px] text-dimmed">
        <span>{{ t('page.marketing.pages.scroll.legend_all') }}</span>
        <span>{{ t('page.marketing.pages.scroll.legend_few') }}</span>
      </span>
      <span
        v-if="scrollViews > 0 && scrollFoldRatio > 0 && scrollFoldRatio < 1"
        class="flex items-center gap-2 text-xs text-muted"
      >
        <span
          class="h-2 w-2 shrink-0 rounded-full bg-default shadow ring-1 ring-default"
          aria-hidden="true"
        />
        <span class="h-px w-4 shrink-0 bg-current" aria-hidden="true" />
        {{ t('page.marketing.pages.scroll.fold_line') }}
      </span>
      <p v-if="scrollViews > 0" class="text-xs text-muted">
        {{
          t('page.marketing.pages.scroll.median', {
            depth: medianDepth,
          })
        }}
      </p>
      <p class="text-xs text-dimmed">
        {{ t('page.marketing.pages.scroll.lines_hint') }}
      </p>
    </div>
    <div v-if="usedIn && usedIn.length > 0" class="flex flex-col gap-2">
      <DmsEyebrow :label="t('page.marketing.pages.used_in')" />
      <DmsAutoLink
        v-for="funnel in usedIn"
        :key="funnel._id"
        :to="funnelLink(funnel._id)"
        class="flex items-center gap-2 rounded-lg border border-default p-2.5 transition-colors hover:border-primary"
      >
        <DmsIconWell icon="i-ph-funnel" size="sm" tone="primary" />
        <span class="truncate text-sm font-medium text-highlighted">
          {{ funnel.name }}
        </span>
      </DmsAutoLink>
    </div>
    <p
      v-if="overlayMode === 'clicks'"
      class="mt-auto flex gap-1.5 text-xs text-dimmed"
    >
      <UIcon name="i-ph-crosshair" class="mt-0.5 size-3.5 shrink-0" />
      {{ t('page.marketing.pages.anchoring_note') }}
    </p>
  </aside>
</template>
