<script setup lang="ts">
import { useI18n } from '#dms/frontend-module'
import {
  MAX_EXPERIMENT_KEY_LENGTH,
  MAX_VARIATIONS,
  MIN_VARIATIONS,
} from '../../../utils/funnel-draft'
import { fractionDigits } from '../../../constants'
import type { VariationDraft } from '../../types/funnelBuilder'

/** The A/B section of `FunnelBuilder`: the switch, the experiment key, the weighted variations and the code that asks for one. */
defineProps<{
  VARIATION_CONTROL_PREFIX: string
  addVariation: () => void
  clearVariationError: () => void
  fieldErrors: ReturnType<typeof useFieldErrors>
  firstUrlStep: string
  flaggedVariation: number | null
  frozen: boolean
  letter: (index: number) => string
  removeVariation: (index: number) => void
  share: (arm: VariationDraft) => number
  snippet: string
  variations: VariationDraft[]
}>()

const { t, locale } = useI18n()

const splitEnabled = defineModel<boolean>('splitEnabled', { required: true })
const experimentKey = defineModel<string>('experimentKey', { required: true })
</script>

<template>
  <section class="flex flex-col gap-3 p-5">
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h2
        class="flex items-center gap-2 text-sm font-semibold text-highlighted"
      >
        <span class="font-mono text-xs text-primary">04</span>
        {{ t('page.marketing.builder.sections.split') }}
      </h2>
      <span class="text-xs text-dimmed">
        {{ t('page.marketing.builder.optional') }}
      </span>
    </div>
    <div class="flex items-start gap-3 rounded-lg border border-default p-4">
      <DmsIconWell icon="i-ph-flask" tone="primary" size="md" />
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-semibold text-highlighted">
          {{ t('page.marketing.builder.split_title') }}
        </span>
        <span class="block text-xs text-muted">
          {{ t('page.marketing.builder.split_description') }}
        </span>
      </span>
      <USwitch
        v-model="splitEnabled"
        :disabled="frozen"
        :aria-label="t('page.marketing.builder.split_title')"
      />
    </div>
    <template v-if="splitEnabled">
      <DmsBanner
        v-if="frozen"
        tone="info"
        size="sm"
        icon="i-ph-lock-simple"
        :title="t('page.marketing.builder.frozen_title')"
        :description="t('page.marketing.builder.frozen_description')"
      />
      <DmsFieldRow
        layout="stack"
        spacing="list"
        :inset="false"
        label="$page.marketing.builder.key"
        description="$page.marketing.builder.key_hint"
        label-for="funnel-experiment-key"
        required
      >
        <UInput
          id="funnel-experiment-key"
          v-model="experimentKey"
          class="w-full max-w-72 font-mono"
          placeholder="sale-hero"
          :maxlength="MAX_EXPERIMENT_KEY_LENGTH"
          :disabled="frozen"
          aria-required="true"
          v-bind="fieldErrors.aria('experiment')"
          @update:model-value="fieldErrors.clear('experiment')"
        />
        <DmsFieldError
          :id="fieldErrors.errorId('experiment')"
          :message="fieldErrors.errors.experiment"
        />
      </DmsFieldRow>
      <div class="flex flex-wrap items-center justify-between gap-x-3">
        <span class="text-sm font-medium text-highlighted">
          {{ t('page.marketing.builder.variations') }}
        </span>
        <span class="text-xs text-dimmed">
          {{
            t('page.marketing.builder.variations_hint', {
              min: MIN_VARIATIONS,
              max: MAX_VARIATIONS,
            })
          }}
        </span>
      </div>
      <ul class="flex flex-col gap-2">
        <li
          v-for="(arm, index) in variations"
          :key="arm.uid"
          class="grid grid-cols-[1.5rem_minmax(0,1fr)_6rem_3rem_auto] items-center gap-2 sm:grid-cols-[1.5rem_minmax(0,1fr)_6rem_5rem_3rem_auto]"
        >
          <span
            class="grid size-6 place-items-center rounded font-mono text-[11px] font-semibold"
            :class="
              index === 0
                ? 'bg-elevated text-toned'
                : 'bg-primary/15 text-(--ui-color-primary-800) dark:text-primary'
            "
          >
            {{ letter(index) }}
          </span>
          <UInput
            :id="`${VARIATION_CONTROL_PREFIX}${arm.uid}`"
            v-model="arm.key"
            size="sm"
            class="font-mono"
            :maxlength="MAX_EXPERIMENT_KEY_LENGTH"
            :placeholder="index === 0 ? 'control' : 'video-hero'"
            :disabled="frozen"
            :aria-label="
              t('page.marketing.builder.variation_key_label', {
                letter: letter(index),
              })
            "
            v-bind="
              flaggedVariation === arm.uid ? fieldErrors.aria('variations') : {}
            "
            @update:model-value="clearVariationError"
          />
          <UInput
            v-model.number="arm.weight"
            type="number"
            :min="0"
            size="sm"
            :disabled="frozen"
            :aria-label="
              t('page.marketing.builder.variation_weight_label', {
                letter: letter(index),
              })
            "
            @update:model-value="clearVariationError"
          >
            <template #trailing>
              <span class="text-xs text-dimmed">
                {{ t('page.marketing.builder.weight') }}
              </span>
            </template>
          </UInput>
          <span
            class="hidden h-1.5 overflow-hidden rounded-full bg-elevated sm:block"
          >
            <span
              class="block h-full rounded-full"
              :class="index === 0 ? 'bg-(--ui-text-dimmed)' : 'bg-primary'"
              :style="{ width: `${share(arm)}%` }"
            />
          </span>
          <span
            class="text-right font-mono text-xs font-semibold text-highlighted"
          >
            {{ formatPercentage(share(arm) / 100, locale, fractionDigits(0)) }}
          </span>
          <UButton
            icon="i-ph-x"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="frozen || variations.length <= MIN_VARIATIONS"
            :aria-label="
              t('page.marketing.builder.remove_variation_n', {
                letter: letter(index),
              })
            "
            @click="removeVariation(index)"
          />
        </li>
      </ul>
      <DmsFieldError
        :id="fieldErrors.errorId('variations')"
        :message="fieldErrors.errors.variations"
      />
      <UButton
        v-if="!frozen"
        icon="i-ph-plus"
        size="sm"
        color="neutral"
        variant="ghost"
        class="self-start"
        :disabled="variations.length >= MAX_VARIATIONS"
        :label="t('page.marketing.builder.add_variation')"
        @click="addVariation"
      />
      <div class="overflow-hidden rounded-lg border border-default">
        <div
          class="flex items-center justify-between gap-2 border-b border-default px-3 py-1.5"
        >
          <DmsEyebrow
            class="min-w-0 truncate"
            :label="
              t('page.marketing.builder.snippet_title', {
                path: firstUrlStep,
              })
            "
          />
          <DmsCopyButton :value="snippet" />
        </div>
        <pre
          class="overflow-x-auto px-3 py-2.5 font-mono text-xs leading-relaxed text-toned"
          >{{ snippet }}</pre>
      </div>
      <DmsBanner
        v-if="!frozen"
        tone="primary"
        size="sm"
        icon="i-ph-lock-simple-open"
        :title="t('page.marketing.builder.draft_title')"
        :description="t('page.marketing.builder.draft_description')"
      />
    </template>
  </section>
</template>
