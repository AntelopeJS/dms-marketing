<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDmsRouter, useI18n } from '#dms/frontend-module'
import { useMarketingContext } from '../composables/useMarketingContext'
import {
  useMarketingApi,
  type MarketingFunnelStep,
  type MarketingFunnelSuggestions,
} from '../composables/useMarketingApi'
import { funnelBuilderLink } from '../composables/useMarketingRoutes'
import { formatNumber } from '../utils/format'

/**
 * The first-run state of the funnels table: funnels built from what the site
 * already sends (its most visited pages and its custom events), and a blank
 * start. The table draws it while the website has no funnel.
 */
const props = withDefaults(
  defineProps<{ state?: string; componentId?: string; pageId?: string }>(),
  { state: undefined, componentId: undefined, pageId: undefined },
)

void props

interface Template {
  id: string
  title: string
  steps: MarketingFunnelStep[]
  entering: number
}

const { t, locale } = useI18n()
const router = useDmsRouter()
const api = useMarketingApi()
const context = useMarketingContext()

const suggestions = ref<MarketingFunnelSuggestions | null>(null)

onMounted(async () => {
  const website = context.selected.value?.id
  if (!website) {
    return
  }
  try {
    suggestions.value = await api.getFunnelSuggestions(website)
  } catch {
    suggestions.value = { pages: [], events: [] }
  }
})

const templates = computed<Template[]>(() => {
  const pages = suggestions.value?.pages ?? []
  const events = suggestions.value?.events ?? []
  return events.slice(0, 2).map((event, index) => {
    const page = pages[index + 1] ?? pages[0]
    const steps: MarketingFunnelStep[] = page
      ? [
          { kind: 'url', value: page.value },
          { kind: 'custom', value: event.value },
        ]
      : [{ kind: 'custom', value: event.value }]
    return {
      id: `${page?.value ?? ''}-${event.value}`,
      title: event.value,
      steps,
      entering: page?.count ?? event.count,
    }
  })
})

function startFrom(template: Template | null): void {
  void router.push(funnelBuilderLink(null, { steps: template?.steps }))
}
</script>

<template>
  <section class="p-6">
    <DmsEmptyState
      icon="i-ph-funnel"
      hatched
      :card="false"
      :title="
        t('page.marketing.funnels.empty.title', {
          website: context.selected.value?.name ?? '',
        })
      "
      :description="t('page.marketing.funnels.empty.description')"
    />
    <div class="mt-6 grid gap-3 md:grid-cols-3">
      <button
        v-for="template in templates"
        :key="template.id"
        type="button"
        class="dms-card flex flex-col items-start gap-2 p-4 text-left transition-colors hover:border-primary"
        @click="startFrom(template)"
      >
        <DmsEyebrow :label="t('page.marketing.funnels.empty.template')" />
        <span class="font-mono text-sm font-semibold text-highlighted">
          {{ template.title }}
        </span>
        <span class="flex flex-wrap items-center gap-1">
          <span
            v-for="step in template.steps"
            :key="step.value"
            class="rounded border px-1.5 py-0.5 font-mono text-[11px]"
            :class="
              step.kind === 'custom'
                ? 'border-primary/40 text-primary'
                : 'border-default text-toned'
            "
          >
            {{ step.value }}
          </span>
        </span>
        <span class="text-xs text-muted">
          {{
            t('page.marketing.funnels.empty.entering', {
              count: formatNumber(template.entering, locale),
            })
          }}
        </span>
      </button>
      <button
        type="button"
        class="flex flex-col items-start gap-2 rounded-xl border border-dashed border-default p-4 text-left transition-colors hover:border-primary"
        @click="startFrom(null)"
      >
        <DmsEyebrow :label="t('page.marketing.funnels.empty.blank')" />
        <span class="text-sm font-semibold text-highlighted">
          {{ t('page.marketing.funnels.empty.scratch') }}
        </span>
        <span class="text-xs text-muted">
          {{ t('page.marketing.funnels.empty.scratch_description') }}
        </span>
      </button>
    </div>
  </section>
</template>
