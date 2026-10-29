<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDmsRoute, useDmsRouter, useI18n } from '#dms/frontend-module'
import { parseExperimentValue } from '../composables/useExperiment'
import { parseFunnelStepsValue } from '../composables/useFunnelSteps'
import { useLatestRequest } from '../composables/useLatestRequest'
import {
  saveFunnel,
  useMarketingApi,
  type MarketingExperiment,
  type MarketingFunnelPreview,
  type MarketingFunnelStep,
  type MarketingFunnelSuggestions,
} from '../composables/useMarketingApi'
import {
  useContextOnDemand,
  useFunnelRead,
  useFunnelSuggestions,
} from '../composables/useMarketingReads'
import type { ContextWebsite } from '../composables/useMarketingContext'
import {
  funnelBuilderLink,
  funnelLink,
  funnelsLink,
} from '../composables/useMarketingRoutes'
import { useContextLink } from '../composables/useContextLink'
import { useCopyDraft } from '../composables/useCopyDraft'
import {
  DEFAULT_WINDOW_HOURS,
  draftIssues,
  isWindowHours,
  MAX_EXPERIMENT_KEY_LENGTH,
  MAX_NAME_LENGTH,
  MAX_STEP_VALUE_LENGTH,
  MAX_STEPS,
  MAX_VARIATIONS,
  MAX_WINDOW_HOURS,
  MIN_VARIATIONS,
  splitSampleSize,
  templateSteps,
  localizedSnippetComments,
  variationSnippet,
  WINDOW_PRESET_HOURS,
  withRequestedSplit,
  type DraftField,
  type FunnelDraftValues,
} from '../utils/funnel-draft'
import { formatNumber } from '../utils/format'
import { normalizeFunnelStepPath } from '../utils/step-path'
import { fractionDigits } from '../constants'
import type { StepDraft, VariationDraft } from '../build/types/funnelBuilder'
import FunnelBuilderSplit from '../build/components/funnel-builder/FunnelBuilderSplit.vue'
import FunnelBuilderSteps from '../build/components/funnel-builder/FunnelBuilderSteps.vue'
import FunnelBuilderPreview from '../build/components/funnel-builder/FunnelBuilderPreview.vue'
import FunnelBuilderSuggestions from '../build/components/funnel-builder/FunnelBuilderSuggestions.vue'
import { useStepSuggestions } from '../build/composables/useStepSuggestions'
import { useDraftPreview } from '../build/composables/useDraftPreview'
import { useDraftLoad } from '../build/composables/useDraftLoad'
import { useDraftSave } from '../build/composables/useDraftSave'
import { useDraftVariations } from '../build/composables/useDraftVariations'

/**
 * The funnel builder (`?id=` to edit, `?copy=` to start from a copy of a
 * funnel, `?split=1` to open the A/B section switched on, `?steps=` to start from a
 * template). Steps are picked from the pages and events the site already
 * tracks, with their counts; the preview scores the draft over the last 30
 * days while it is edited. Follows the DMS form contract — unsaved changes
 * against a baseline, a guard before leaving, errors under their field — and
 * writes through the funnels data API, which owns the experiment lifecycle.
 */
const props = withDefaults(
  defineProps<{ componentId?: string; pageId?: string }>(),
  {
    componentId: undefined,
    pageId: undefined,
  },
)

const PREVIEW_DEBOUNCE_MS = 450
const SUGGESTIONS_SHOWN = 6
const MINIMUM_DETECTABLE_LIFT = 0.2
const LETTER_A = 65
const PERCENT = 100
const MS_PER_HOUR = 3_600_000
const HTTP_NOT_FOUND = 404
/** Below this, months read "under 0.1". */
const MIN_MONTHS_SHOWN = 0.1

void props

const { t, locale } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const api = useMarketingApi()
const toast = useToast()
const { confirm } = useConfirm()

function queryParam(key: string): string {
  const value = route.query[key]
  return typeof value === 'string' ? value : ''
}

const funnelId = queryParam('id')
const sourceId = funnelId ? '' : queryParam('copy')
const isEdit = funnelId !== ''

let nextUid = 1
const uid = () => nextUid++

const name = ref('')
const websiteId = ref<string>('')
const steps = ref<StepDraft[]>([{ uid: uid(), kind: 'url', value: '' }])
const windowHours = ref<number | string>(DEFAULT_WINDOW_HOURS)
const splitEnabled = ref(route.query.split === '1')
const experimentKey = ref('')
const variations = ref<VariationDraft[]>([
  { uid: uid(), key: 'control', weight: 1 },
  { uid: uid(), key: '', weight: 1 },
])
const original = ref<MarketingExperiment | null>(null)
/** The goal a started test was saved with, to warn before it changes. */
const savedObjective = ref('')
const loading = ref(true)
const loadFailed = ref<'not_found' | 'error' | null>(null)
const saving = ref(false)

/** A started split keeps its key and arms: changing them would reassign visitors. */
const frozen = computed(
  () => original.value !== null && original.value.status !== 'draft',
)

// --- Form values, baseline and leave guard -------------------------------------

function values(): FunnelDraftValues {
  return {
    name: name.value,
    websiteId: websiteId.value,
    steps: steps.value.map(({ kind, value }) => ({ kind, value })),
    windowHours: windowHours.value,
    split: splitEnabled.value,
    experimentKey: experimentKey.value,
    variations: variations.value.map(({ key, weight }) => ({ key, weight })),
  }
}

function applyValues(next: FunnelDraftValues): void {
  name.value = next.name
  websiteId.value = next.websiteId
  steps.value = next.steps.map((step) => ({ uid: uid(), ...step }))
  windowHours.value = next.windowHours
  splitEnabled.value = next.split
  experimentKey.value = next.experimentKey
  variations.value = next.variations.map((arm) => ({ uid: uid(), ...arm }))
}

const { dirty, baseline, markClean } = useFormDirty(values)
// A Duplicate opens dirty (the copy is a change to save), but an untouched
// copy holds nothing to lose: only edits to it hold the leave.
const copy = useCopyDraft({ values, dirty, markClean })
const { confirmLeave } = useUnsavedChanges({ dirty: copy.unsaved })

// Errors land under their field: the client's checks on a save attempt, and
// the server's — its codes name the field they belong to.
const STEP_CONTROL_PREFIX = 'funnel-step-'
const VARIATION_CONTROL_PREFIX = 'funnel-variation-'
const flaggedStep = ref<number | null>(null)
const flaggedVariation = ref<number | null>(null)

/** The flagged row's input, else the first row's (a server error names no row). */
function rowControl(prefix: string, flagged: number | null, first?: number) {
  return document.getElementById(`${prefix}${flagged ?? first}`)
}

const fieldErrors = useFieldErrors<DraftField>({
  fields: {
    name: 'funnel-name',
    websiteId: 'funnel-website',
    steps: () =>
      rowControl(STEP_CONTROL_PREFIX, flaggedStep.value, steps.value[0]?.uid),
    conversionWindowHours: 'funnel-window',
    experiment: 'funnel-experiment-key',
    variations: () =>
      rowControl(
        VARIATION_CONTROL_PREFIX,
        flaggedVariation.value,
        variations.value[0]?.uid,
      ),
  },
  codes: {
    '$page.marketing.errors.invalid_steps': 'steps',
    '$page.marketing.errors.invalid_experiment_key': 'experiment',
    '$page.marketing.errors.duplicate_experiment_key': 'experiment',
    '$page.marketing.errors.experiment_locked': 'experiment',
    '$page.marketing.errors.invalid_variations': 'variations',
    '$page.marketing.errors.website_not_found': 'websiteId',
  },
})

function clearStepError(): void {
  flaggedStep.value = null
  fieldErrors.clear('steps')
}

function clearVariationError(): void {
  flaggedVariation.value = null
  fieldErrors.clear('variations')
}

const { objectiveOf, websites, load } = useDraftLoad(
  funnelId,
  sourceId,
  values,
  applyValues,
  route,
  original,
  savedObjective,
  t,
  copy,
  queryParam,
  websiteId,
  loading,
  loadFailed,
  isEdit,
  steps,
  uid,
  markClean,
  HTTP_NOT_FOUND,
)

const {
  suggestions,
  focusedStep,
  activeOption,
  matchesFor,
  listOpen,
  focusStep,
  blurStep,
  typeStep,
  pick,
  onStepKeydown,
  optionId,
} = useStepSuggestions(
  websiteId,
  SUGGESTIONS_SHOWN,
  clearStepError,
  STEP_CONTROL_PREFIX,
)

const {
  validSteps,
  previewable,
  preview,
  previewing,
  previewFailed,
  previewCount,
  previewRows,
  stepHint,
  entered,
  endToEnd,
  stepRate,
  sampleHint,
} = useDraftPreview(
  steps,
  windowHours,
  websiteId,
  api,
  PREVIEW_DEBOUNCE_MS,
  t,
  PERCENT,
  locale,
  MINIMUM_DETECTABLE_LIFT,
  variations,
  frozen,
  MIN_MONTHS_SHOWN,
)

// --- Editing -------------------------------------------------------------------

function addStep(kind: MarketingFunnelStep['kind'] = 'url', value = ''): void {
  clearStepError()
  const empty = steps.value.find((step) => step.value.trim() === '')
  if (value && empty) {
    empty.kind = kind
    empty.value = value
    return
  }
  if (steps.value.length < MAX_STEPS) {
    steps.value.push({ uid: uid(), kind, value })
  }
}

function removeStep(index: number): void {
  clearStepError()
  steps.value.splice(index, 1)
}

function moveStep(index: number, offset: number): void {
  const target = index + offset
  if (target < 0 || target >= steps.value.length) {
    return
  }
  const [step] = steps.value.splice(index, 1)
  steps.value.splice(target, 0, step!)
}

const windowItems = computed(() =>
  WINDOW_PRESET_HOURS.map((hours) => ({
    value: hours,
    label: t(`page.marketing.builder.window_presets.${hours}`),
  })),
)

const {
  kindItems,
  share,
  addVariation,
  removeVariation,
  letter,
  firstUrlStep,
  snippetComments,
} = useDraftVariations(
  t,
  variations,
  PERCENT,
  clearVariationError,
  uid,
  LETTER_A,
  validSteps,
)

const snippet = computed(() =>
  variationSnippet(
    experimentKey.value.trim() || 'experiment-key',
    variations.value[0]?.key.trim() || 'control',
    [variations.value[1]?.key.trim() || 'variation'],
    snippetComments.value,
  ),
)

const {
  objectiveChanged,
  save,
  discard,
  inContext,
  backLink,
  leave,
  websiteItems,
} = useDraftSave(
  frozen,
  objectiveOf,
  values,
  savedObjective,
  fieldErrors,
  flaggedStep,
  steps,
  flaggedVariation,
  variations,
  t,
  splitEnabled,
  original,
  experimentKey,
  confirm,
  saving,
  websiteId,
  name,
  validSteps,
  windowHours,
  api,
  funnelId,
  copy,
  toast,
  router,
  clearStepError,
  clearVariationError,
  applyValues,
  baseline,
  isEdit,
  sourceId,
  confirmLeave,
  websites,
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex items-start gap-4">
      <UButton
        icon="i-ph-arrow-left"
        color="neutral"
        variant="ghost"
        :aria-label="t('page.marketing.funnel.back')"
        @click="leave(backLink)"
      />
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-semibold break-words text-highlighted">
          {{
            loadFailed
              ? t('page.marketing.builder.page_title')
              : isEdit
                ? t('page.marketing.builder.edit_title', { name: name || '…' })
                : t('page.marketing.builder.title')
          }}
        </h1>
        <p v-if="!loadFailed" class="mt-1 max-w-3xl text-sm text-muted">
          {{ t('page.marketing.builder.subtitle') }}
        </p>
      </div>
      <UButton
        v-if="isEdit && !loading && !loadFailed"
        icon="i-ph-copy"
        color="neutral"
        variant="outline"
        :label="t('page.marketing.builder.duplicate')"
        @click="
          leave(inContext(funnelBuilderLink(null, { copy: funnelId })), true)
        "
      />
    </header>

    <div v-if="loading" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <USkeleton class="h-[36rem] rounded-xl" />
      <USkeleton class="h-72 rounded-xl" />
    </div>

    <DmsEmptyState
      v-else-if="loadFailed"
      variant="error"
      class="dms-card"
      :title="
        t(
          loadFailed === 'not_found'
            ? 'page.marketing.errors.funnel_not_found'
            : 'page.marketing.builder.load_error',
        )
      "
    >
      <template #actions>
        <UButton
          v-if="loadFailed === 'error'"
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-ph-arrow-clockwise"
          :label="t('page.marketing.common.retry')"
          @click="load"
        />
        <UButton
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-ph-arrow-left"
          :label="t('page.marketing.funnel.back')"
          @click="router.push(inContext(funnelsLink()))"
        />
      </template>
    </DmsEmptyState>

    <div
      v-else
      class="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]"
    >
      <div class="dms-card flex min-w-0 flex-col divide-y divide-default p-0">
        <section class="flex flex-col gap-4 p-5">
          <h2
            class="flex items-center gap-2 text-sm font-semibold text-highlighted"
          >
            <span class="font-mono text-xs text-primary">01</span>
            {{ t('page.marketing.builder.sections.basics') }}
          </h2>
          <div class="grid gap-4 md:grid-cols-2">
            <DmsFieldRow
              layout="stack"
              spacing="list"
              :inset="false"
              label="$page.marketing.builder.name"
              label-for="funnel-name"
              required
            >
              <UInput
                id="funnel-name"
                v-model="name"
                class="w-full"
                :maxlength="MAX_NAME_LENGTH"
                aria-required="true"
                :placeholder="t('page.marketing.builder.name_placeholder')"
                v-bind="fieldErrors.aria('name')"
                @update:model-value="fieldErrors.clear('name')"
              />
              <DmsFieldError
                :id="fieldErrors.errorId('name')"
                :message="fieldErrors.errors.name"
              />
            </DmsFieldRow>
            <DmsFieldRow
              layout="stack"
              spacing="list"
              :inset="false"
              label="$page.marketing.builder.website"
              :description="
                isEdit && frozen
                  ? '$page.marketing.builder.website_locked'
                  : undefined
              "
              label-for="funnel-website"
              required
            >
              <USelect
                id="funnel-website"
                v-model="websiteId"
                class="w-full"
                :items="websiteItems"
                :disabled="isEdit && frozen"
                required
                v-bind="fieldErrors.aria('websiteId')"
                @update:model-value="fieldErrors.clear('websiteId')"
              />
              <DmsFieldError
                :id="fieldErrors.errorId('websiteId')"
                :message="fieldErrors.errors.websiteId"
              />
            </DmsFieldRow>
          </div>
        </section>

        <FunnelBuilderSteps
          :STEP_CONTROL_PREFIX="STEP_CONTROL_PREFIX"
          :active-option="activeOption"
          :add-step="addStep"
          :blur-step="blurStep"
          :clear-step-error="clearStepError"
          :field-errors="fieldErrors"
          :flagged-step="flaggedStep"
          :focus-step="focusStep"
          :focused-step="focusedStep"
          :kind-items="kindItems"
          :list-open="listOpen"
          :matches-for="matchesFor"
          :move-step="moveStep"
          :objective-changed="objectiveChanged"
          :on-step-keydown="onStepKeydown"
          :option-id="optionId"
          :pick="pick"
          :preview-count="previewCount"
          :remove-step="removeStep"
          :step-hint="stepHint"
          :steps="steps"
          :type-step="typeStep"
        />

        <section class="flex flex-col gap-3 p-5">
          <div
            class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
          >
            <h2
              class="flex items-center gap-2 text-sm font-semibold text-highlighted"
            >
              <span class="font-mono text-xs text-primary">03</span>
              {{ t('page.marketing.builder.sections.window') }}
            </h2>
            <span class="text-xs text-dimmed">
              {{ t('page.marketing.builder.window_hint') }}
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <DmsSegmented
              v-model="windowHours"
              :items="windowItems"
              variant="mono"
              size="sm"
              @update:model-value="fieldErrors.clear('conversionWindowHours')"
            />
            <span class="text-xs text-dimmed">
              {{ t('page.marketing.builder.or') }}
            </span>
            <UInput
              id="funnel-window"
              v-model.number="windowHours"
              type="number"
              :min="1"
              :max="MAX_WINDOW_HOURS"
              :step="1"
              size="sm"
              class="w-28"
              :aria-label="t('page.marketing.builder.window_label')"
              v-bind="fieldErrors.aria('conversionWindowHours')"
              @update:model-value="fieldErrors.clear('conversionWindowHours')"
            >
              <template #trailing>
                <span class="text-xs text-dimmed">
                  {{ t('page.marketing.builder.hours') }}
                </span>
              </template>
            </UInput>
            <span class="text-xs text-dimmed">
              {{
                t('page.marketing.builder.window_max', {
                  max: MAX_WINDOW_HOURS,
                })
              }}
            </span>
          </div>
          <DmsFieldError
            :id="fieldErrors.errorId('conversionWindowHours')"
            :message="fieldErrors.errors.conversionWindowHours"
          />
        </section>

        <FunnelBuilderSplit
          v-model:split-enabled="splitEnabled"
          v-model:experiment-key="experimentKey"
          :VARIATION_CONTROL_PREFIX="VARIATION_CONTROL_PREFIX"
          :add-variation="addVariation"
          :clear-variation-error="clearVariationError"
          :field-errors="fieldErrors"
          :first-url-step="firstUrlStep"
          :flagged-variation="flaggedVariation"
          :frozen="frozen"
          :letter="letter"
          :remove-variation="removeVariation"
          :share="share"
          :snippet="snippet"
          :variations="variations"
        />

        <div class="px-5 py-3">
          <DmsFormRequiredLegend />
        </div>
      </div>

      <aside class="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4">
        <FunnelBuilderPreview
          :end-to-end="endToEnd"
          :entered="entered"
          :preview-failed="previewFailed"
          :preview-rows="previewRows"
          :previewable="previewable"
          :previewing="previewing"
          :sample-hint="sampleHint"
          :split-enabled="splitEnabled"
          :step-rate="stepRate"
          :valid-steps="validSteps"
        />

        <FunnelBuilderSuggestions
          :add-step="addStep"
          :suggestions="suggestions"
        />
      </aside>
    </div>

    <DmsSaveBar
      v-if="!loading && !loadFailed"
      :dirty="dirty"
      :saving="saving"
      :save-label="
        isEdit
          ? '$page.marketing.common.save_changes'
          : '$page.marketing.builder.save'
      "
      cancellable
      @save="save"
      @discard="discard"
      @cancel="leave(backLink)"
    />
  </div>
</template>
