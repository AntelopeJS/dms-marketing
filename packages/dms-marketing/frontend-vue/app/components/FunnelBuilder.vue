<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDmsRoute, useDmsRouter, useI18n } from '#dms/frontend-module'
import {
  useMarketingApi,
  type MarketingExperiment,
  type MarketingFunnelPreview,
  type MarketingFunnelStep,
  type MarketingFunnelSuggestions,
} from '../composables/useMarketingApi'
import type { ContextWebsite } from '../composables/useMarketingContext'
import { funnelLink, funnelsLink } from '../composables/useMarketingRoutes'
import { formatNumber, formatPercent } from '../utils/format'
import { sampleSizePerArm } from '../utils/sample-size'

/**
 * The funnel builder (`?id=` to edit, `?split=1` to open the A/B section,
 * `?steps=` to start from a template). Steps are picked from the pages and
 * events the site already tracks, with their counts; the preview scores the
 * draft over the last 30 days while it is edited. Writes through the funnels
 * data API, which owns the validation and the experiment lifecycle rules.
 */
const props = withDefaults(
  defineProps<{ componentId?: string; pageId?: string }>(),
  {
    componentId: undefined,
    pageId: undefined,
  },
)

interface StepDraft {
  uid: number
  kind: MarketingFunnelStep['kind']
  value: string
}

interface VariationDraft {
  uid: number
  key: string
  weight: number
}

const MAX_STEPS = 10
const MIN_VARIATIONS = 2
const MAX_VARIATIONS = 8
const MAX_WINDOW_HOURS = 720
const WINDOW_PRESETS = [1, 24, 168, 720]
const PREVIEW_DEBOUNCE_MS = 450
const SUGGESTIONS_SHOWN = 6
const KEY_PATTERN = /^[a-z0-9_-]+$/
const MINIMUM_DETECTABLE_LIFT = 0.2
const DAYS_PER_MONTH = 30
const LETTER_A = 65
const PERCENT = 100

void props

const { t, locale } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const api = useMarketingApi()
const toast = useToast()

const funnelId = typeof route.query.id === 'string' ? route.query.id : ''
const isEdit = funnelId !== ''

let nextUid = 1
const uid = () => nextUid++

const name = ref('')
const websiteId = ref<string>('')
const steps = ref<StepDraft[]>([{ uid: uid(), kind: 'url', value: '' }])
const windowHours = ref(24)
const splitEnabled = ref(route.query.split === '1')
const experimentKey = ref('')
const variations = ref<VariationDraft[]>([
  { uid: uid(), key: 'control', weight: 1 },
  { uid: uid(), key: '', weight: 1 },
])
const original = ref<MarketingExperiment | null>(null)
const loading = ref(isEdit)
const saving = ref(false)
const dirty = ref(false)

/** A started split keeps its key and arms: changing them would reassign visitors. */
const frozen = computed(
  () => original.value !== null && original.value.status !== 'draft',
)

function readTemplate(): void {
  const raw = route.query.steps
  if (typeof raw !== 'string') {
    return
  }
  try {
    const parsed = JSON.parse(raw) as MarketingFunnelStep[]
    if (Array.isArray(parsed) && parsed.length > 0) {
      steps.value = parsed.map((step) => ({
        uid: uid(),
        kind: step.kind,
        value: step.value,
      }))
    }
  } catch {
    // A malformed template link starts from a blank funnel.
  }
}

async function loadExisting(): Promise<void> {
  try {
    const { funnel } = await api.getFunnelResults(funnelId, '1d')
    name.value = funnel.name
    websiteId.value = funnel.websiteId
    steps.value = funnel.steps.map((step) => ({ uid: uid(), ...step }))
    windowHours.value = Math.round(funnel.conversionWindowMs / 3_600_000)
    const experiment = funnel.experiment ?? null
    original.value = experiment
    if (experiment) {
      splitEnabled.value = true
      experimentKey.value = experiment.key
      variations.value = experiment.variations.map((arm) => ({
        uid: uid(),
        ...arm,
      }))
    }
  } catch {
    toast.add({ color: 'error', title: t('page.marketing.builder.load_error') })
  } finally {
    loading.value = false
    dirty.value = false
  }
}

// The builder sits outside the context bar: it reads the website list and
// the member's selection itself.
const websites = ref<ContextWebsite[]>([])

async function loadWebsites(): Promise<void> {
  const payload = await api.getContext()
  websites.value = payload.websites
  if (!websiteId.value) {
    websiteId.value = payload.selectedId ?? ''
  }
}

onMounted(async () => {
  await loadWebsites().catch(() => undefined)
  readTemplate()
  if (isEdit) {
    await loadExisting()
  }
  void loadSuggestions()
})

watch(
  [
    name,
    websiteId,
    steps,
    windowHours,
    splitEnabled,
    experimentKey,
    variations,
  ],
  () => {
    if (!loading.value) {
      dirty.value = true
    }
  },
  { deep: true },
)

// --- Suggestions and preview -------------------------------------------------

const suggestions = ref<MarketingFunnelSuggestions>({ pages: [], events: [] })

async function loadSuggestions(): Promise<void> {
  if (!websiteId.value) {
    return
  }
  try {
    suggestions.value = await api.getFunnelSuggestions(websiteId.value)
  } catch {
    suggestions.value = { pages: [], events: [] }
  }
}

watch(websiteId, () => void loadSuggestions())

const focusedStep = ref<number | null>(null)

function matchesFor(step: StepDraft) {
  const pool =
    step.kind === 'url' ? suggestions.value.pages : suggestions.value.events
  const needle = step.value.trim().toLowerCase()
  return pool
    .filter((entry) => !needle || entry.value.toLowerCase().includes(needle))
    .filter((entry) => entry.value !== step.value)
    .slice(0, SUGGESTIONS_SHOWN)
}

const BLUR_DELAY_MS = 150

/** Late enough for a click on a suggestion to land first. */
function blurStep(step: StepDraft): void {
  setTimeout(() => {
    if (focusedStep.value === step.uid) {
      focusedStep.value = null
    }
  }, BLUR_DELAY_MS)
}

function pick(step: StepDraft, value: string): void {
  step.value = value
  focusedStep.value = null
}

const validSteps = computed(() =>
  steps.value
    .filter((step) => step.value.trim() !== '')
    .map((step) => ({ kind: step.kind, value: step.value.trim() })),
)

const preview = ref<MarketingFunnelPreview | null>(null)
const previewing = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | null = null

async function runPreview(): Promise<void> {
  if (!websiteId.value || validSteps.value.length === 0) {
    preview.value = null
    return
  }
  previewing.value = true
  try {
    preview.value = await api.previewFunnel(
      websiteId.value,
      validSteps.value,
      clampHours(windowHours.value),
    )
  } catch {
    preview.value = null
  } finally {
    previewing.value = false
  }
}

watch(
  [validSteps, windowHours, websiteId],
  () => {
    if (previewTimer) {
      clearTimeout(previewTimer)
    }
    previewTimer = setTimeout(() => void runPreview(), PREVIEW_DEBOUNCE_MS)
  },
  { deep: true, immediate: true },
)

onBeforeUnmount(() => previewTimer && clearTimeout(previewTimer))

function previewCount(step: StepDraft): number | null {
  const index = validSteps.value.findIndex(
    (valid) => valid.value === step.value.trim() && valid.kind === step.kind,
  )
  return index < 0
    ? null
    : (preview.value?.computation.steps[index]?.sessions ?? null)
}

const entered = computed(
  () => preview.value?.computation.steps[0]?.sessions ?? 0,
)
const converted = computed(
  () => preview.value?.computation.steps.at(-1)?.sessions ?? 0,
)
const endToEnd = computed(() =>
  entered.value > 0 ? (converted.value / entered.value) * PERCENT : null,
)

/** How long the split would need, at the traffic the preview measured. */
const sampleHint = computed(() => {
  const rate = entered.value > 0 ? converted.value / entered.value : 0
  if (rate <= 0) {
    return null
  }
  const perArm = sampleSizePerArm(rate, MINIMUM_DETECTABLE_LIFT)
  const total = perArm * Math.max(MIN_VARIATIONS, variations.value.length)
  const months = total / Math.max(1, entered.value)
  return {
    total: formatNumber(Math.round(total), locale.value),
    rate: formatPercent(rate * PERCENT, locale.value),
    months: formatNumber(
      Math.max(months, 1 / DAYS_PER_MONTH),
      locale.value,
      months < 1 ? 1 : 0,
    ),
    tooSmall: months > 3,
  }
})

// --- Editing -------------------------------------------------------------------

function addStep(kind: MarketingFunnelStep['kind'] = 'url', value = ''): void {
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

function clampHours(hours: number): number {
  return Math.min(Math.max(Math.round(hours) || 1, 1), MAX_WINDOW_HOURS)
}

const windowItems = computed(() =>
  WINDOW_PRESETS.map((hours) => ({
    value: hours,
    label: t(`page.marketing.builder.window_presets.${hours}`),
  })),
)

const kindItems = computed(() => [
  {
    value: 'url',
    label: t('page.marketing.funnel.kind.url'),
    icon: 'i-ph-browser',
  },
  {
    value: 'custom',
    label: t('page.marketing.funnel.kind.custom'),
    icon: 'i-ph-lightning',
  },
])

const totalWeight = computed(
  () =>
    variations.value.reduce(
      (sum, arm) => sum + Math.max(arm.weight || 0, 0),
      0,
    ) || 1,
)

function share(arm: VariationDraft): number {
  return (Math.max(arm.weight || 0, 0) / totalWeight.value) * PERCENT
}

function addVariation(): void {
  if (variations.value.length < MAX_VARIATIONS) {
    variations.value.push({ uid: uid(), key: '', weight: 1 })
  }
}

function letter(index: number): string {
  return String.fromCharCode(LETTER_A + index)
}

const firstUrlStep = computed(
  () => validSteps.value.find((step) => step.kind === 'url')?.value ?? '/',
)

const snippet = computed(() => {
  const challenger = variations.value[1]?.key || 'variation'
  return [
    `const arm = await window.dmsMarketing?.variation("${experimentKey.value || 'experiment-key'}");`,
    `if (arm === "${challenger}") { /* show ${challenger} */ } // null → control`,
  ].join('\n')
})

// --- Validation and save -------------------------------------------------------

const errors = computed(() => {
  const list: string[] = []
  if (!name.value.trim()) {
    list.push(t('page.marketing.builder.errors.name'))
  }
  if (!websiteId.value) {
    list.push(t('page.marketing.builder.errors.website'))
  }
  if (validSteps.value.length === 0) {
    list.push(t('page.marketing.builder.errors.steps'))
  }
  if (splitEnabled.value) {
    if (!KEY_PATTERN.test(experimentKey.value)) {
      list.push(t('page.marketing.builder.errors.key'))
    }
    const keys = variations.value.map((arm) => arm.key.trim())
    if (
      keys.some((key) => !KEY_PATTERN.test(key)) ||
      new Set(keys).size !== keys.length
    ) {
      list.push(t('page.marketing.builder.errors.variations'))
    }
  }
  return list
})

function experimentPayload(): MarketingExperiment | null {
  if (!splitEnabled.value) {
    return null
  }
  if (frozen.value && original.value) {
    return original.value
  }
  return {
    key: experimentKey.value,
    status: original.value?.status ?? 'draft',
    variations: variations.value.map((arm) => ({
      key: arm.key.trim(),
      weight: Math.max(arm.weight || 0, 0),
    })),
    runs: original.value?.runs ?? [],
  }
}

async function save(): Promise<void> {
  if (errors.value.length > 0) {
    return
  }
  saving.value = true
  const input = {
    websiteId: websiteId.value,
    name: name.value.trim(),
    steps: validSteps.value,
    conversionWindowHours: clampHours(windowHours.value),
    experiment: experimentPayload(),
  }
  try {
    const id = isEdit ? funnelId : (await api.createFunnel(input))[0]
    if (isEdit) {
      await api.updateFunnel(funnelId, input)
    }
    dirty.value = false
    toast.add({ color: 'success', title: t('page.marketing.builder.saved') })
    await router.push(id ? funnelLink(id) : funnelsLink())
  } catch (error) {
    const message = (error as { data?: { message?: string } })?.data?.message
    toast.add({
      color: 'error',
      title: t('page.marketing.builder.save_error'),
      description: message,
    })
  } finally {
    saving.value = false
  }
}

function cancel(): void {
  void router.push(isEdit ? funnelLink(funnelId) : funnelsLink())
}

const websiteItems = computed(() =>
  websites.value.map((site) => ({
    value: site.id,
    label: `${site.name} · ${site.domain}`,
  })),
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
        @click="cancel"
      />
      <div>
        <h1 class="text-2xl font-semibold text-highlighted">
          {{
            isEdit
              ? t('page.marketing.builder.edit_title', { name: name || '…' })
              : t('page.marketing.builder.title')
          }}
        </h1>
        <p class="mt-1 max-w-3xl text-sm text-muted">
          {{ t('page.marketing.builder.subtitle') }}
        </p>
      </div>
    </header>

    <div v-if="loading" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <USkeleton class="h-[36rem] rounded-xl" />
      <USkeleton class="h-72 rounded-xl" />
    </div>

    <div
      v-else
      class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]"
    >
      <div class="dms-card flex flex-col divide-y divide-default p-0">
        <section class="flex flex-col gap-4 p-5">
          <h2
            class="flex items-center gap-2 text-sm font-semibold text-highlighted"
          >
            <span class="font-mono text-xs text-primary">01</span>
            {{ t('page.marketing.builder.sections.basics') }}
          </h2>
          <div class="grid gap-4 md:grid-cols-2">
            <UFormField :label="t('page.marketing.builder.name')" required>
              <UInput
                v-model="name"
                class="w-full"
                :placeholder="t('page.marketing.builder.name_placeholder')"
              />
            </UFormField>
            <UFormField :label="t('page.marketing.builder.website')">
              <USelect
                v-model="websiteId"
                class="w-full"
                :items="websiteItems"
                :disabled="isEdit"
              />
            </UFormField>
          </div>
        </section>

        <section class="flex flex-col gap-3 p-5">
          <div class="flex items-center justify-between gap-3">
            <h2
              class="flex items-center gap-2 text-sm font-semibold text-highlighted"
            >
              <span class="font-mono text-xs text-primary">02</span>
              {{ t('page.marketing.builder.sections.steps') }}
            </h2>
            <span class="text-xs text-dimmed">
              {{ t('page.marketing.builder.steps_hint', { max: MAX_STEPS }) }}
            </span>
          </div>
          <ol class="flex flex-col gap-2">
            <li
              v-for="(step, index) in steps"
              :key="step.uid"
              class="relative grid grid-cols-[auto_1.75rem_9rem_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border p-2"
              :class="
                focusedStep === step.uid ? 'border-primary' : 'border-default'
              "
            >
              <span class="flex flex-col">
                <UButton
                  icon="i-ph-caret-up"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :disabled="index === 0"
                  :aria-label="t('page.marketing.builder.move_up')"
                  @click="moveStep(index, -1)"
                />
                <UButton
                  icon="i-ph-caret-down"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :disabled="index === steps.length - 1"
                  :aria-label="t('page.marketing.builder.move_down')"
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
              <USelect v-model="step.kind" :items="kindItems" size="sm" />
              <div class="relative">
                <UInput
                  v-model="step.value"
                  size="sm"
                  class="w-full font-mono"
                  :placeholder="
                    step.kind === 'url' ? '/pricing' : 'signup_submitted'
                  "
                  @focus="focusedStep = step.uid"
                  @blur="blurStep(step)"
                />
                <ul
                  v-if="focusedStep === step.uid && matchesFor(step).length > 0"
                  class="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-default bg-default shadow-lg"
                  role="listbox"
                >
                  <li class="px-3 pt-2 pb-1">
                    <DmsEyebrow
                      :label="
                        t(
                          step.kind === 'url'
                            ? 'page.marketing.builder.tracked_pages'
                            : 'page.marketing.builder.tracked_events',
                        )
                      "
                    />
                  </li>
                  <li v-for="match in matchesFor(step)" :key="match.value">
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-elevated"
                      @mousedown.prevent="pick(step, match.value)"
                    >
                      <UIcon
                        :name="
                          step.kind === 'url'
                            ? 'i-ph-browser'
                            : 'i-ph-lightning'
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
                          )
                        }}
                      </span>
                    </button>
                  </li>
                </ul>
              </div>
              <span
                class="min-w-20 text-right font-mono text-[11px] text-muted"
              >
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
                :aria-label="t('page.marketing.builder.remove_step')"
                @click="removeStep(index)"
              />
            </li>
          </ol>
          <div class="flex items-center gap-3">
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

        <section class="flex flex-col gap-3 p-5">
          <div class="flex items-center justify-between gap-3">
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
            />
            <span class="text-xs text-dimmed">
              {{ t('page.marketing.builder.or') }}
            </span>
            <UInput
              v-model.number="windowHours"
              type="number"
              :min="1"
              :max="MAX_WINDOW_HOURS"
              size="sm"
              class="w-28"
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
        </section>

        <section class="flex flex-col gap-3 p-5">
          <div class="flex items-center justify-between gap-3">
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
          <div
            class="flex items-start gap-3 rounded-lg border border-default p-4"
          >
            <DmsIconWell icon="i-ph-flask" tone="primary" size="md" />
            <span class="flex-1">
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
            <UFormField
              :label="t('page.marketing.builder.key')"
              :description="t('page.marketing.builder.key_hint')"
            >
              <UInput
                v-model="experimentKey"
                class="w-72 font-mono"
                placeholder="sale-hero"
                :disabled="frozen"
              />
            </UFormField>
            <div class="flex items-center justify-between">
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
                class="grid grid-cols-[1.5rem_minmax(0,1fr)_6rem_5rem_3rem_auto] items-center gap-2"
              >
                <span
                  class="grid size-6 place-items-center rounded font-mono text-[11px] font-semibold"
                  :class="
                    index === 0
                      ? 'bg-elevated text-toned'
                      : 'bg-primary/15 text-primary'
                  "
                >
                  {{ letter(index) }}
                </span>
                <UInput
                  v-model="arm.key"
                  size="sm"
                  class="font-mono"
                  :placeholder="index === 0 ? 'control' : 'video-hero'"
                  :disabled="frozen"
                />
                <UInput
                  v-model.number="arm.weight"
                  type="number"
                  :min="0"
                  size="sm"
                  :disabled="frozen"
                >
                  <template #trailing>
                    <span class="text-xs text-dimmed">
                      {{ t('page.marketing.builder.weight') }}
                    </span>
                  </template>
                </UInput>
                <span class="h-1.5 overflow-hidden rounded-full bg-elevated">
                  <span
                    class="block h-full rounded-full"
                    :class="
                      index === 0 ? 'bg-(--ui-text-dimmed)' : 'bg-primary'
                    "
                    :style="{ width: `${share(arm)}%` }"
                  />
                </span>
                <span
                  class="text-right font-mono text-xs font-semibold text-highlighted"
                >
                  {{ formatPercent(share(arm), locale, 0) }}
                </span>
                <UButton
                  icon="i-ph-x"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :disabled="frozen || variations.length <= MIN_VARIATIONS"
                  :aria-label="t('page.marketing.builder.remove_variation')"
                  @click="variations.splice(index, 1)"
                />
              </li>
            </ul>
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
                class="flex items-center justify-between border-b border-default px-3 py-1.5"
              >
                <DmsEyebrow
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
      </div>

      <aside class="flex flex-col gap-4 lg:sticky lg:top-4">
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
              v-if="!preview || preview.computation.steps.length === 0"
              class="py-4 text-center text-sm text-muted"
            >
              {{ t('page.marketing.builder.preview_empty') }}
            </p>
            <template v-else>
              <div
                v-for="(row, index) in preview.computation.steps"
                :key="index"
                class="grid grid-cols-[1rem_minmax(0,1fr)_4rem] items-center gap-2"
              >
                <span class="font-mono text-[11px] text-dimmed">
                  {{ index + 1 }}
                </span>
                <span class="h-2 overflow-hidden rounded-full bg-elevated">
                  <span
                    class="block h-full rounded-full bg-primary"
                    :style="{
                      width: `${entered > 0 ? (row.sessions / entered) * 100 : 0}%`,
                    }"
                  />
                </span>
                <span
                  class="text-right font-mono text-xs font-semibold text-highlighted"
                >
                  {{ formatNumber(row.sessions, locale) }}
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
                    endToEnd === null ? '—' : formatPercent(endToEnd, locale)
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

        <section class="dms-card p-0">
          <header class="border-b border-default px-4 py-3">
            <DmsEyebrow :label="t('page.marketing.builder.events_title')" />
          </header>
          <ul class="divide-y divide-default">
            <li
              v-for="event in suggestions.events.slice(0, 6)"
              :key="event.value"
            >
              <button
                type="button"
                class="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-elevated/60"
                @click="addStep('custom', event.value)"
              >
                <span
                  class="flex-1 truncate font-mono text-[13px] text-highlighted"
                >
                  {{ event.value }}
                </span>
                <span class="font-mono text-[11px] text-dimmed">
                  {{ formatNumber(event.count, locale) }}
                </span>
              </button>
            </li>
            <li
              v-if="suggestions.events.length === 0"
              class="px-4 py-4 text-center text-sm text-muted"
            >
              {{ t('page.marketing.builder.no_events') }}
            </li>
          </ul>
          <footer
            class="flex items-center gap-1.5 border-t border-default px-4 py-2.5 font-mono text-[11px] text-dimmed"
          >
            <UIcon name="i-ph-code" class="size-3.5" />
            {{ t('page.marketing.builder.events_hint') }}
          </footer>
        </section>
      </aside>
    </div>

    <div
      class="sticky bottom-0 z-30 -mx-1 rounded-xl border border-default bg-default/90 shadow-lg backdrop-blur"
    >
      <div class="flex items-center gap-3 px-4 py-3">
        <span v-if="dirty" class="flex items-center gap-2 text-sm text-muted">
          <span class="size-2 rounded-full bg-warning" />
          {{ t('page.marketing.builder.unsaved') }}
        </span>
        <span v-else-if="errors.length > 0" class="text-sm text-muted">
          {{ errors[0] }}
        </span>
        <UButton
          class="ms-auto"
          color="neutral"
          variant="outline"
          :label="t('page.marketing.common.cancel')"
          @click="cancel"
        />
        <UButton
          icon="i-ph-check"
          :loading="saving"
          :disabled="errors.length > 0 || (!dirty && isEdit)"
          :label="t('page.marketing.builder.save')"
          @click="save"
        />
      </div>
    </div>
  </div>
</template>
