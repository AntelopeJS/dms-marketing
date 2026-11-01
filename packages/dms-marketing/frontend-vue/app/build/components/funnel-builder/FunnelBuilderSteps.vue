<script setup lang="ts">
import { useI18n } from '#dms/frontend-module'
import type {
  MarketingFunnelStep,
  MarketingFunnelSuggestion,
} from '../../../composables/useMarketingApi'
import { formatNumber } from '../../../utils/format'
import { MAX_STEP_VALUE_LENGTH, MAX_STEPS } from '../../../utils/funnel-draft'
import type { StepDraft } from '../../types/funnelBuilder'

/** The steps section of `FunnelBuilder`: each step's kind and value, with suggestions as it is typed, its preview count and its controls. */
defineProps<{
  STEP_CONTROL_PREFIX: string
  activeOption: number
  addStep: (kind?: MarketingFunnelStep['kind'], value?: string) => void
  blurStep: (step: StepDraft) => void
  clearStepError: () => void
  fieldErrors: ReturnType<typeof useFieldErrors>
  flaggedStep: number | null
  focusStep: (step: StepDraft) => void
  focusedStep: number | null
  kindItems: { value: string; label: string; icon: string }[]
  listOpen: (step: StepDraft) => boolean
  matchesFor: (step: StepDraft) => MarketingFunnelSuggestion[]
  moveStep: (index: number, offset: number) => void
  objectiveChanged: boolean
  onStepKeydown: (event: KeyboardEvent, step: StepDraft) => void
  optionId: (step: StepDraft, index: number) => string
  pick: (step: StepDraft, value: string) => void
  previewCount: (step: StepDraft) => number | null
  removeStep: (index: number) => void
  stepHint: (step: StepDraft) => { text: string; warning: boolean } | null
  steps: StepDraft[]
  typeStep: () => void
}>()

const { t, locale } = useI18n()
</script>

<template>
  <section class="flex flex-col gap-3 p-5">
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h2
        class="flex items-center gap-2 text-sm font-semibold text-highlighted"
      >
        <span class="font-mono text-xs text-primary">02</span>
        <span>
          {{ t('page.marketing.builder.sections.steps') }}
          <span class="text-error" aria-hidden="true">*</span>
        </span>
      </h2>
      <span class="text-xs text-dimmed">
        {{ t('page.marketing.builder.steps_hint', { max: MAX_STEPS }) }}
      </span>
    </div>
    <DmsBanner
      v-if="objectiveChanged"
      tone="warning"
      size="sm"
      icon="i-ph-warning"
      :title="t('page.marketing.builder.objective_title')"
      :description="t('page.marketing.builder.objective_description')"
    />
    <ol class="flex flex-col gap-2">
      <li
        v-for="(step, index) in steps"
        :key="step.uid"
        class="relative grid grid-cols-[auto_1.75rem_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border p-2 md:grid-cols-[auto_1.75rem_9rem_minmax(0,1fr)_auto_auto]"
        :class="
          flaggedStep === step.uid
            ? 'border-error'
            : focusedStep === step.uid
              ? 'border-primary'
              : 'border-default'
        "
      >
        <span class="flex flex-col">
          <UButton
            icon="i-ph-caret-up"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="index === 0"
            :aria-label="
              t('page.marketing.builder.move_up_step', { n: index + 1 })
            "
            @click="moveStep(index, -1)"
          />
          <UButton
            icon="i-ph-caret-down"
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="index === steps.length - 1"
            :aria-label="
              t('page.marketing.builder.move_down_step', { n: index + 1 })
            "
            @click="moveStep(index, 1)"
          />
        </span>
        <span
          class="grid size-7 place-items-center rounded-md font-mono text-xs"
          :class="
            index === steps.length - 1 && steps.length > 1
              ? 'bg-primary text-inverted'
              : 'bg-elevated text-toned'
          "
        >
          <UIcon
            v-if="index === steps.length - 1 && steps.length > 1"
            name="i-ph-flag-checkered"
            class="size-3.5"
          />
          <template v-else>{{ index + 1 }}</template>
        </span>
        <USelect
          v-model="step.kind"
          :items="kindItems"
          size="sm"
          :aria-label="
            t('page.marketing.builder.step_kind_label', { n: index + 1 })
          "
          @update:model-value="clearStepError"
        />
        <div
          class="relative order-last col-span-full md:order-none md:col-span-1"
        >
          <UInput
            :id="`${STEP_CONTROL_PREFIX}${step.uid}`"
            v-model="step.value"
            size="sm"
            class="w-full font-mono"
            :maxlength="MAX_STEP_VALUE_LENGTH"
            :placeholder="step.kind === 'url' ? '/pricing' : 'signup_submitted'"
            role="combobox"
            aria-autocomplete="list"
            :aria-label="
              t('page.marketing.builder.step_value_label', {
                n: index + 1,
              })
            "
            :aria-expanded="listOpen(step)"
            :aria-controls="`${STEP_CONTROL_PREFIX}${step.uid}-list`"
            :aria-activedescendant="
              listOpen(step) && activeOption >= 0
                ? optionId(step, activeOption)
                : undefined
            "
            v-bind="flaggedStep === step.uid ? fieldErrors.aria('steps') : {}"
            @focus="focusStep(step)"
            @blur="blurStep(step)"
            @keydown="onStepKeydown($event, step)"
            @update:model-value="typeStep"
          />
          <div
            v-if="listOpen(step)"
            class="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-default bg-default shadow-lg"
          >
            <div class="px-3 pt-2 pb-1">
              <DmsEyebrow
                :label="
                  t(
                    step.kind === 'url'
                      ? 'page.marketing.builder.tracked_pages'
                      : 'page.marketing.builder.tracked_events',
                  )
                "
              />
            </div>
            <ul :id="`${STEP_CONTROL_PREFIX}${step.uid}-list`" role="listbox">
              <li
                v-for="(match, matchIndex) in matchesFor(step)"
                :id="optionId(step, matchIndex)"
                :key="match.value"
                role="option"
                :aria-selected="activeOption === matchIndex"
                class="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-elevated"
                :class="{ 'bg-elevated': activeOption === matchIndex }"
                @mousedown.prevent="pick(step, match.value)"
              >
                <UIcon
                  :name="
                    step.kind === 'url' ? 'i-ph-browser' : 'i-ph-lightning'
                  "
                  class="size-3.5 text-dimmed"
                />
                <span
                  class="flex-1 truncate font-mono text-[13px] text-highlighted"
                >
                  {{ match.value }}
                </span>
                <span class="font-mono text-[11px] text-dimmed">
                  {{
                    t(
                      step.kind === 'url'
                        ? 'page.marketing.builder.views'
                        : 'page.marketing.builder.triggers',
                      { count: formatNumber(match.count, locale) },
                      match.count,
                    )
                  }}
                </span>
              </li>
            </ul>
          </div>
          <p
            v-if="stepHint(step)"
            class="mt-1 flex items-center gap-1 text-xs"
            :class="stepHint(step)!.warning ? 'text-warning' : 'text-dimmed'"
          >
            <UIcon
              :name="stepHint(step)!.warning ? 'i-ph-warning' : 'i-ph-info'"
              class="size-3.5 shrink-0"
            />
            {{ stepHint(step)!.text }}
          </p>
        </div>
        <span class="text-right font-mono text-[11px] text-muted md:min-w-20">
          <template v-if="previewCount(step) !== null">
            <span class="font-semibold text-highlighted">
              {{ formatNumber(previewCount(step)!, locale) }}
            </span>
            {{ t('page.marketing.builder.sessions_short') }}
          </template>
        </span>
        <UButton
          icon="i-ph-x"
          size="xs"
          color="neutral"
          variant="ghost"
          :disabled="steps.length === 1"
          :aria-label="
            t('page.marketing.builder.remove_step_n', { n: index + 1 })
          "
          @click="removeStep(index)"
        />
      </li>
    </ol>
    <DmsFieldError
      :id="fieldErrors.errorId('steps')"
      :message="fieldErrors.errors.steps"
    />
    <div class="flex flex-wrap items-center gap-3">
      <UButton
        icon="i-ph-plus"
        size="sm"
        color="neutral"
        variant="outline"
        :disabled="steps.length >= MAX_STEPS"
        :label="t('page.marketing.builder.add_step')"
        @click="addStep()"
      />
      <span class="text-xs text-dimmed">
        {{ t('page.marketing.builder.goal_hint') }}
      </span>
    </div>
  </section>
</template>
