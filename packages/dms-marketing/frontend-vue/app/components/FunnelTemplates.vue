<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDmsRoute, useDmsRouter, useI18n } from '#dms/frontend-module'
import { useMarketingContext } from '../composables/useMarketingContext'
import {
  useMarketingApi,
  type MarketingFunnelStep,
  type MarketingFunnelTemplate,
} from '../composables/useMarketingApi'
import {
  funnelBuilderLink,
  installLink,
  linkInContext,
} from '../composables/useMarketingRoutes'
import { formatNumber } from '../utils/format'
import { PERIOD_SCOPE } from '../constants'

/**
 * The first-run state of the funnels table: funnels built from the site's
 * own journeys over the period (its most triggered events, each led by the
 * page its sessions viewed most often before it), and a blank start. A site
 * that sent nothing yet is sent to its install guide instead.
 */
const props = withDefaults(
  defineProps<{ state?: string; componentId?: string; pageId?: string }>(),
  { state: undefined, componentId: undefined, pageId: undefined },
)

void props

const { t, locale } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const api = useMarketingApi()
const context = useMarketingContext()
const period = usePeriodScope(PERIOD_SCOPE)

const templates = ref<MarketingFunnelTemplate[] | null>(null)

watch(
  [
    () => context.selected.value?.id,
    () => period.value?.range?.from.getTime(),
    () => period.value?.range?.to.getTime(),
  ],
  async ([website]) => {
    if (!website) {
      return
    }
    templates.value = null
    try {
      templates.value = await api.getFunnelTemplates(website, period.value)
    } catch {
      templates.value = []
    }
  },
  { immediate: true },
)

/** The site has sent nothing yet: templates cannot come before the tracker. */
const waiting = computed(() => context.selected.value?.state === 'waiting')

function startFrom(steps: MarketingFunnelStep[] | null): void {
  void router.push(
    linkInContext(
      funnelBuilderLink(null, { steps: steps ?? undefined }),
      route.query as Record<string, unknown>,
    ),
  )
}

function stepsKey(steps: MarketingFunnelStep[]): string {
  return steps.map((step) => step.value).join('>')
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
      :description="
        t(
          waiting
            ? 'page.marketing.funnels.empty.description_waiting'
            : templates && templates.length === 0
              ? 'page.marketing.funnels.empty.description_none'
              : 'page.marketing.funnels.empty.description',
          { website: context.selected.value?.name ?? '' },
        )
      "
    >
      <template v-if="waiting" #actions>
        <UButton
          size="sm"
          icon="i-ph-plug"
          :label="t('page.marketing.funnels.empty.install')"
          :to="installLink(context.selected.value?.id)"
        />
      </template>
    </DmsEmptyState>
    <div class="mt-6 grid gap-3 md:grid-cols-3">
      <template v-if="templates === null && !waiting">
        <USkeleton v-for="index in 2" :key="index" class="h-32 rounded-xl" />
      </template>
      <button
        v-for="template in templates ?? []"
        :key="stepsKey(template.steps)"
        type="button"
        class="dms-card flex min-w-0 flex-col items-start gap-2 p-4 text-left transition-colors hover:border-primary"
        @click="startFrom(template.steps)"
      >
        <DmsEyebrow :label="t('page.marketing.funnels.empty.template')" />
        <span
          class="max-w-full truncate font-mono text-sm font-semibold text-highlighted"
        >
          {{ template.steps.at(-1)?.value }}
        </span>
        <span class="flex max-w-full flex-wrap items-center gap-1">
          <span
            v-for="step in template.steps"
            :key="step.value"
            class="max-w-full truncate rounded border px-1.5 py-0.5 font-mono text-[11px]"
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
            t(
              'page.marketing.funnels.empty.entering',
              { count: formatNumber(template.entering, locale) },
              template.entering,
            )
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
