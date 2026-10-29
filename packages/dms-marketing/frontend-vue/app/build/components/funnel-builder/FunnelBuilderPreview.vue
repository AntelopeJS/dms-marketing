<script setup lang="ts">
import { useI18n } from '#dms/frontend-module'
import type { MarketingFunnelPreview } from '../../../composables/useMarketingApi'
import { formatNumber } from '../../../utils/format'
import { fractionDigits } from '../../../constants'
import type { StepDraft } from '../../types/funnelBuilder'

/** The live preview card of `FunnelBuilder`: the draft read over the last 30 days, step by step, with the sample a split would need. */
defineProps<{
  endToEnd: number | null
  entered: number
  previewFailed: boolean
  previewRows: MarketingFunnelPreview['computation']['steps']
  previewable: boolean
  previewing: boolean
  sampleHint: {
    total: string
    rate: ReturnType<typeof formatPercentage>
    duration: string
    tooSmall: boolean
  } | null
  splitEnabled: boolean
  stepRate: (index: number) => string | null
  validSteps: { kind: StepDraft['kind']; value: string }[]
}>()

const { t, locale } = useI18n()
</script>

<template>
  <section class="dms-card p-0">
    <header
      class="flex items-center justify-between border-b border-default px-4 py-3"
    >
      <DmsEyebrow :label="t('page.marketing.builder.preview')" />
      <UIcon
        v-if="previewing"
        name="i-ph-circle-notch"
        class="size-4 animate-spin text-dimmed"
      />
    </header>
    <div class="flex flex-col gap-2 px-4 py-3">
      <p
        v-if="validSteps.length > 0 && !previewable"
        class="py-4 text-center text-sm text-muted"
      >
        {{ t('page.marketing.builder.preview_invalid') }}
      </p>
      <p v-else-if="previewFailed" class="py-4 text-center text-sm text-muted">
        {{ t('page.marketing.builder.preview_error') }}
      </p>
      <p
        v-else-if="previewRows.length === 0"
        class="py-4 text-center text-sm text-muted"
      >
        {{ t('page.marketing.builder.preview_empty') }}
      </p>
      <template v-else>
        <div
          v-for="(row, index) in previewRows"
          :key="index"
          class="flex flex-col gap-1"
        >
          <div class="flex items-center gap-2 text-xs">
            <span class="w-4 shrink-0 font-mono text-[11px] text-dimmed">
              {{ index + 1 }}
            </span>
            <span
              class="min-w-0 flex-1 truncate font-mono text-toned"
              :title="row.step.value"
            >
              {{ row.step.value }}
            </span>
            <span
              v-if="stepRate(index)"
              class="shrink-0 font-mono text-[11px] text-dimmed"
              :title="t('page.marketing.builder.step_rate')"
            >
              {{ stepRate(index) }}
            </span>
            <span
              class="w-14 shrink-0 text-right font-mono font-semibold text-highlighted"
            >
              {{ formatNumber(row.sessions, locale) }}
            </span>
          </div>
          <span class="ms-6 h-1.5 overflow-hidden rounded-full bg-elevated">
            <span
              class="block h-full rounded-full bg-primary"
              :style="{
                width: `${entered > 0 ? (row.sessions / entered) * 100 : 0}%`,
              }"
            />
          </span>
        </div>
        <div
          class="mt-2 flex items-center justify-between border-t border-default pt-2"
        >
          <span class="text-sm text-muted">
            {{ t('page.marketing.builder.end_to_end') }}
          </span>
          <span class="font-mono text-sm font-semibold text-highlighted">
            {{
              endToEnd === null
                ? '—'
                : formatPercentage(endToEnd / 100, locale, fractionDigits(1))
            }}
          </span>
        </div>
      </template>
      <p
        v-if="splitEnabled && sampleHint"
        class="mt-1 flex gap-1.5 text-xs"
        :class="sampleHint.tooSmall ? 'text-warning' : 'text-muted'"
      >
        <UIcon name="i-ph-info" class="mt-0.5 size-3.5 shrink-0" />
        {{ t('page.marketing.builder.sample_hint', sampleHint) }}
      </p>
    </div>
  </section>
</template>
