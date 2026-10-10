<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDmsRoute, useDmsRouter, useI18n } from '#dms/frontend-module'
import { useMarketingContext } from '../composables/useMarketingContext'
import {
  useMarketingApi,
  type MarketingExperimentStatus,
  type MarketingFunnelResults,
} from '../composables/useMarketingApi'
import {
  funnelBuilderLink,
  funnelsLink,
} from '../composables/useMarketingRoutes'
import { formatShortDate } from '../utils/format'
import { MS_PER_DAY } from '../constants'

/**
 * The page of one funnel (`?id=`): its title and actions, then the funnel
 * report, or the A/B test report once the funnel carries a started split.
 * Reads the results with the period scope; a split ignores the period and is
 * read over its own runs, which its subtitle says.
 */
const props = withDefaults(
  defineProps<{
    periodScope?: string
    componentId?: string
    pageId?: string
  }>(),
  { periodScope: undefined, componentId: undefined, pageId: undefined },
)

const { t, locale } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const api = useMarketingApi()
const context = useMarketingContext()
const toast = useToast()
const { confirm } = useConfirm()

const funnelId = computed(() => {
  const id = route.query.id
  return typeof id === 'string' ? id : ''
})

const reloadToken = ref(0)

const { data, isLoading, error, refresh } =
  useChartFetch<MarketingFunnelResults>({
    fetchUrl: `/api/marketing/funnels/${encodeURIComponent(funnelId.value)}/results`,
    periodScope: props.periodScope,
    watchSource: () => reloadToken.value,
  })

const funnel = computed(() => data.value?.funnel ?? null)
const experiment = computed(() => funnel.value?.experiment ?? null)
const status = computed<MarketingExperimentStatus | null>(
  () => experiment.value?.status ?? null,
)
const isSplit = computed(() => experiment.value !== null)

const subtitle = computed(() => {
  const current = funnel.value
  if (!current) {
    return ''
  }
  const website = context.selected.value?.name ?? ''
  const split = experiment.value
  if (split && data.value && split.status !== 'draft') {
    const since = data.value.window.since
    const days = Math.max(
      1,
      Math.round((data.value.window.until - since) / MS_PER_DAY),
    )
    return t(`page.marketing.funnel.subtitle_${split.status}`, {
      key: split.key,
      website,
      date: formatShortDate(since, locale.value),
      until: formatShortDate(data.value.window.until, locale.value),
      days,
    })
  }
  if (split) {
    return t('page.marketing.funnel.subtitle_draft', {
      key: split.key,
      website,
    })
  }
  return t('page.marketing.funnel.subtitle', {
    steps: current.steps.length,
    hours: Math.round(current.conversionWindowMs / 3_600_000),
  })
})

// --- Lifecycle ---------------------------------------------------------------

const changing = ref(false)

async function writeStatus(target: MarketingExperimentStatus): Promise<void> {
  const current = funnel.value
  const split = experiment.value
  if (!current || !split) {
    return
  }
  changing.value = true
  try {
    await api.updateFunnel(current._id, {
      websiteId: current.websiteId,
      name: current.name,
      steps: current.steps,
      conversionWindowHours: Math.round(current.conversionWindowMs / 3_600_000),
      experiment: { ...split, status: target },
    })
    toast.add({
      color: 'success',
      title: t(`page.marketing.funnel.lifecycle.${target}_done`),
    })
    reloadToken.value++
  } catch {
    toast.add({
      color: 'error',
      title: t('page.marketing.funnel.lifecycle.error'),
    })
  } finally {
    changing.value = false
  }
}

async function start(): Promise<void> {
  const split = experiment.value
  if (!split || !funnel.value) {
    return
  }
  const total =
    split.variations.reduce((sum, arm) => sum + Math.max(arm.weight, 0), 0) || 1
  const shares = split.variations
    .map(
      (arm) =>
        `${arm.key} ${Math.round((Math.max(arm.weight, 0) / total) * 100)}%`,
    )
    .join(' · ')
  await confirm({
    title: t('page.marketing.funnel.lifecycle.start_title', {
      name: funnel.value.name,
    }),
    description: t('page.marketing.funnel.lifecycle.start_description', {
      website: context.selected.value?.name ?? '',
    }),
    color: 'success',
    icon: 'i-ph-play',
    confirmLabel: t('page.marketing.funnel.lifecycle.start_confirm'),
    impact: [
      {
        icon: 'i-ph-lock-simple',
        label: t('page.marketing.funnel.lifecycle.start_freezes', {
          key: split.key,
          shares,
        }),
      },
      {
        icon: 'i-ph-code',
        label: t('page.marketing.funnel.lifecycle.start_code', {
          key: split.key,
        }),
      },
    ],
    onConfirm: () => writeStatus('running'),
  })
}

async function stop(): Promise<void> {
  await confirm({
    title: t('page.marketing.funnel.lifecycle.stop_title'),
    description: t('page.marketing.funnel.lifecycle.stop_description'),
    color: 'warning',
    icon: 'i-ph-stop',
    confirmLabel: t('page.marketing.funnel.lifecycle.stop_confirm'),
    onConfirm: () => writeStatus('stopped'),
  })
}

async function resume(): Promise<void> {
  await confirm({
    title: t('page.marketing.funnel.lifecycle.resume_title'),
    description: t('page.marketing.funnel.lifecycle.resume_description'),
    confirmLabel: t('page.marketing.funnel.lifecycle.resume_confirm'),
    onConfirm: () => writeStatus('running'),
  })
}

async function remove(): Promise<void> {
  const current = funnel.value
  if (!current) {
    return
  }
  await confirm({
    title: t('page.marketing.funnel.delete.title', { name: current.name }),
    description: t('page.marketing.funnel.delete.description'),
    color: 'error',
    confirmLabel: t('page.marketing.funnel.delete.confirm'),
    confirmText: current.name,
    onConfirm: async () => {
      await api.deleteFunnel(current._id)
      toast.add({
        color: 'success',
        title: t('page.marketing.funnel.delete.done'),
      })
      await router.push(funnelsLink())
    },
  })
}

const moreItems = computed(() => [
  [
    {
      label: t('page.marketing.funnel.delete.action'),
      icon: 'i-ph-trash',
      color: 'error' as const,
      onSelect: () => void remove(),
    },
  ],
])
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex flex-wrap items-start gap-4">
      <UButton
        icon="i-ph-arrow-left"
        color="neutral"
        variant="ghost"
        :to="funnelsLink()"
        :aria-label="t('page.marketing.funnel.back')"
      />
      <div class="min-w-0 flex-1">
        <USkeleton v-if="!funnel && isLoading" class="h-8 w-72" />
        <h1
          v-else
          class="flex flex-wrap items-center gap-2 text-2xl font-semibold text-highlighted"
        >
          {{ funnel?.name ?? t('page.marketing.funnel.title') }}
          <DmsStatusPill
            size="sm"
            uppercase
            :icon="isSplit ? 'i-ph-flask' : 'i-ph-funnel'"
            :label="
              t(
                isSplit
                  ? 'page.marketing.funnel.kind_ab'
                  : 'page.marketing.funnel.kind_funnel',
              )
            "
          />
          <DmsStatusPill
            v-if="status"
            size="sm"
            :tone="
              status === 'running'
                ? 'success'
                : status === 'draft'
                  ? 'info'
                  : 'neutral'
            "
            :dot="status === 'running' ? 'pulse' : 'static'"
            :label="t(`page.marketing.funnels.status.${status}`)"
          />
        </h1>
        <p class="mt-1 max-w-3xl text-sm text-muted" :class="isSplit ? '' : ''">
          {{ subtitle }}
        </p>
      </div>
      <div v-if="funnel" class="flex flex-wrap items-center gap-2">
        <UButton
          icon="i-ph-pencil-simple"
          color="neutral"
          variant="outline"
          :label="
            t(
              isSplit
                ? 'page.marketing.funnel.edit'
                : 'page.marketing.funnel.edit_steps',
            )
          "
          :to="funnelBuilderLink(funnel._id)"
        />
        <UButton
          v-if="!isSplit"
          icon="i-ph-flask"
          color="neutral"
          variant="outline"
          :label="t('page.marketing.funnel.split')"
          :to="funnelBuilderLink(funnel._id, { split: true })"
        />
        <UButton
          v-if="status === 'draft'"
          icon="i-ph-play"
          color="success"
          :loading="changing"
          :label="t('page.marketing.funnel.lifecycle.start')"
          @click="start"
        />
        <UButton
          v-else-if="status === 'running'"
          icon="i-ph-stop"
          color="warning"
          variant="outline"
          :loading="changing"
          :label="t('page.marketing.funnel.lifecycle.stop')"
          @click="stop"
        />
        <UButton
          v-else-if="status === 'stopped'"
          icon="i-ph-play"
          color="neutral"
          variant="outline"
          :loading="changing"
          :label="t('page.marketing.funnel.lifecycle.resume')"
          @click="resume"
        />
        <UDropdownMenu :items="moreItems" :content="{ align: 'end' }">
          <UButton
            icon="i-ph-dots-three"
            color="neutral"
            variant="outline"
            :aria-label="t('page.marketing.common.more')"
          />
        </UDropdownMenu>
      </div>
    </header>

    <DmsEmptyState
      v-if="error && !data"
      variant="error"
      class="dms-card"
      :title="t('page.marketing.funnel.error')"
      :description="t('page.marketing.common.data_safe')"
    >
      <template #actions>
        <UButton
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-ph-arrow-clockwise"
          :label="t('page.marketing.common.retry')"
          @click="refresh"
        />
      </template>
    </DmsEmptyState>

    <div v-else-if="!data" class="grid gap-4 md:grid-cols-4">
      <USkeleton v-for="index in 4" :key="index" class="h-24 rounded-xl" />
      <USkeleton class="h-80 rounded-xl md:col-span-4" />
    </div>

    <DmsMarketingExperimentReport
      v-else-if="isSplit && status !== 'draft'"
      :results="data"
      :loading="isLoading"
    />

    <DmsMarketingFunnelFigure
      v-else
      :results="data"
      :loading="isLoading"
      :website-name="context.selected.value?.name ?? ''"
    />
  </div>
</template>
