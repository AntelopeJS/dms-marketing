<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  useDmsRoute,
  useDmsRouter,
  useI18n,
} from '#dms/frontend-module'
import { useChildId } from '../composables/useChildId'
import { parseExperimentValue } from '../composables/useExperiment'
import { parseFunnelStepsValue } from '../composables/useFunnelSteps'
import { useLatestRequest } from '../composables/useLatestRequest'
import {
  useMarketingApi,
  type MarketingExperimentStatus,
  type MarketingFunnelListItem,
} from '../composables/useMarketingApi'
import {
  MARKETING_PERIOD_PRESETS,
  ndToPreset,
  useMarketingPeriod,
} from '../composables/useMarketingPeriod'
import { funnelsLink } from '../composables/useMarketingRoutes'
import { useMarketingWebsites } from '../composables/useMarketingWebsites'
import { dmsComponent } from '../utils/dmsComponent'

/**
 * Conversion funnels of a site, plain or split into A/B arms: the
 * definitions list on the left, the figure of the selected one on the right —
 * the tracked-pages layout, for the same reason: picking what to look at is
 * a single-selection gesture, and it, the period and the URL state belong to
 * one surface.
 *
 * Definitions CRUD goes through the funnels data-api — create/edit open the
 * generic DmsForm in a modal, delete and the lifecycle transitions sit in the
 * detail pane; the selection lives in the URL so a funnel can be linked to.
 */
const PERIOD_SCOPE = 'dms-marketing-funnels'

// Declared, not inherited as attributes: the DMS page renderer hands every
// component its identity, and an undeclared prop lands on the root element.
const props = withDefaults(
  defineProps<{ componentId?: string, pageId?: string }>(),
  { componentId: 'marketing-funnels', pageId: 'marketing' },
)

const childId = useChildId(() => props.componentId)

const api = useMarketingApi()
const { t } = useI18n()
const route = useDmsRoute()
const router = useDmsRouter()
const modal = useModal()
const toast = useToast()

const queryParam = (key: string): string => {
  const value = route.query[key]
  return typeof value === 'string' ? value : ''
}

// Read once: the selector seeds its preset at init and never reactively, so a
// deep link's window has to be resolved before it renders.
const initialPreset = ndToPreset(queryParam('period'))

const {
  websites,
  items: websiteItems,
  selectedId: selectedWebsiteId,
  loading: loadingWebsites,
  failed: websitesFailed,
  load: loadWebsites,
  create: createWebsite,
} = useMarketingWebsites(queryParam('website'))

// `undefined`, not null: this is what DmsMasterDetail's model is typed on.
const selectedFunnelId = ref<string | undefined>(
  queryParam('funnel') || undefined,
)

const period = useMarketingPeriod(PERIOD_SCOPE)

/** Bumped after an edit so the detail recomputes an unchanged selection. */
const refreshToken = ref(0)

const {
  data: funnelList,
  loading: loadingFunnels,
  failed: funnelsFailed,
  run: loadFunnels,
} = useLatestRequest(() =>
  // Server-side there is no session to authenticate with: the fetch belongs
  // to the client, like every other read here.
  selectedWebsiteId.value && !import.meta.env.SSR
    ? api.listFunnels(selectedWebsiteId.value)
    : null,
)

const funnels = computed(() => funnelList.value?.results ?? [])

const selectedFunnel = computed(
  () => funnels.value.find(funnel => funnel._id === selectedFunnelId.value) ?? null,
)

const selectedExperiment = computed(() =>
  parseExperimentValue(selectedFunnel.value?.experiment),
)

// Two failures, two flags: the list fetch clears its own error on every
// attempt, and must not clear the one that says the site list never loaded.
const failed = computed(() => websitesFailed.value || funnelsFailed.value)

// Land on something rather than on an empty pane. A linked funnel wins, but
// only while the list confirms it exists: a deleted or foreign-site id from
// the URL would pin the detail pane on an error no retry can clear. Watching
// the answer rather than writing from the fetch keeps superseded ones out:
// only the newest ever reaches here.
watch(funnelList, (data) => {
  if (!data) {
    return
  }
  const selected = selectedFunnelId.value
  if (selected && data.results.some(funnel => funnel._id === selected)) {
    return
  }
  selectedFunnelId.value = data.results[0]?._id
})

/**
 * Retry entry point. Both fetches, in order, because either can be the one
 * that failed: on a deep link the list runs even when the site list did not,
 * and reloading the site list alone leaves the selection unchanged, so the
 * watcher never fires and the funnels are never retried.
 */
async function reload() {
  if (websites.value.length === 0) {
    await loadWebsites()
  }
  await loadFunnels()
}

onMounted(loadWebsites)

// The watcher owns every list fetch, including the first: definitions do not
// depend on the period, only on the site. Switching site invalidates the
// selection — only a real site-to-site change may clear it: the immediate run
// hands the watcher an undefined previous, and the site list resolving
// undefined → id is not a switch either. Both carry a linked funnel that must
// survive.
watch(selectedWebsiteId, (websiteId, previousWebsiteId) => {
  if (previousWebsiteId !== undefined && websiteId !== previousWebsiteId) {
    selectedFunnelId.value = undefined
  }
  void loadFunnels()
}, { immediate: true })

// State lives in the URL so a funnel can be linked to. Query-only navigation
// does not remount the page, so this is free.
watch([selectedWebsiteId, selectedFunnelId, period], () => {
  void router.replace(
    funnelsLink({
      website: selectedWebsiteId.value,
      funnel: selectedFunnelId.value,
      period: period.value,
    }),
  )
})

const statusLabels = computed<Record<MarketingExperimentStatus, string>>(() => ({
  draft: t('page.marketing.funnels.status.draft'),
  running: t('page.marketing.funnels.status.running'),
  stopped: t('page.marketing.funnels.status.stopped'),
}))

const STATUS_ICONS: Record<MarketingExperimentStatus, string> = {
  draft: 'i-ph-pencil-simple-line',
  running: 'i-ph-play',
  stopped: 'i-ph-stop',
}

const listItems = computed(() =>
  funnels.value.map((funnel) => {
    const experiment = parseExperimentValue(funnel.experiment)
    const stepCount = parseFunnelStepsValue(funnel.steps).length
    const stepsLabel = t(
      'page.marketing.funnels.steps_count',
      { count: stepCount },
      stepCount,
    )
    if (!experiment) {
      return {
        value: funnel._id,
        label: funnel.name,
        sublabel: stepsLabel,
        icon: 'i-ph-funnel',
      }
    }
    const status = experiment.status ?? 'draft'
    const armCount = experiment.variations.length
    return {
      value: funnel._id,
      label: funnel.name,
      sublabel: `${statusLabels.value[status]} · ${t(
        'page.marketing.funnels.variations_count',
        { count: armCount },
        armCount,
      )}`,
      icon: STATUS_ICONS[status],
    }
  }),
)

// --- Definitions CRUD -------------------------------------------------------

const FUNNELS_TABLE_BASE = '/api/marketing/tables/funnels'

/**
 * The writable field set of a funnel definition, declared for the generic
 * DmsForm so create/edit look like every other DMS form. The website is not
 * a field: it rides in submitDefaults — the submit only carries declared
 * fields plus those, so the expanded relation a fetch may hydrate never
 * reaches the write path. The experiment's status is never edited here: new
 * rows start in draft server-side, transitions go through the detail pane.
 *
 * The JSON schema is not optional garnish: without one the form validates
 * against an EMPTY zod object, and the parsed submit drops every field. Fine
 * validation (step shapes, key slug, arm bounds) stays with the data-api.
 */
const FUNNEL_FORM_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    steps: { type: 'array' },
    conversionWindowHours: { type: 'number', minimum: 1, maximum: 720 },
    experiment: { type: ['object', 'null'] },
  },
  required: ['name', 'steps'],
}

const FUNNEL_FORM_FIELDS = [
  {
    id: 'name',
    label: '$page.marketing.funnels.column.name',
    required: true,
    component: {
      componentName: 'dms-input-text',
      options: { placeholder: '$page.marketing.funnels.form.name' },
    },
  },
  {
    id: 'steps',
    label: '$page.marketing.funnels.form.steps',
    description: '$page.marketing.funnels.form.steps_description',
    required: true,
    component: { componentName: 'DmsMarketingFunnelStepsInput' },
  },
  {
    id: 'conversionWindowHours',
    label: '$page.marketing.funnels.form.window',
    defaultValue: 24,
    component: {
      componentName: 'dms-input-number',
      options: { min: 1, max: 720 },
    },
  },
  {
    id: 'experiment',
    label: '$page.marketing.funnels.form.experiment',
    description: '$page.marketing.funnels.form.experiment_description',
    component: { componentName: 'DmsMarketingExperimentInput' },
  },
]

interface FunnelFormTarget {
  title: string
  websiteId: string
  fetchUrl?: string
  submitUrl: string
  submitUrlMethod: 'POST' | 'PUT'
  /** The saved row id, from the submit response. */
  resolveId: (response: unknown) => string
}

/** The generic form closes through onSuccessCallback; a plain dismiss
 * resolves the container result with undefined. */
function openFunnelForm(target: FunnelFormTarget): Promise<{ _id: string } | undefined> {
  const instance = modal.open<{ _id: string } | undefined>({
    title: target.title,
    size: 'lg',
    component: dmsComponent('dms-form'),
    componentOptions: {
      fields: FUNNEL_FORM_FIELDS,
      schema: FUNNEL_FORM_SCHEMA,
      fetchUrl: target.fetchUrl,
      fetchUrlMethod: 'GET',
      submitUrl: target.submitUrl,
      submitUrlMethod: target.submitUrlMethod,
      submitDefaults: { websiteId: target.websiteId },
      onSuccessCallback: (response?: unknown) => {
        instance.close({ _id: target.resolveId(response) })
      },
    },
  })
  return instance.result
}

async function openCreate(): Promise<void> {
  const websiteId = selectedWebsiteId.value
  if (!websiteId) {
    return
  }
  const saved = await openFunnelForm({
    title: t('page.marketing.funnels.create_title'),
    websiteId,
    submitUrl: `${FUNNELS_TABLE_BASE}/new`,
    submitUrlMethod: 'POST',
    // The insert answers the generated keys, an array — not the row.
    resolveId: response => (Array.isArray(response) ? String(response[0] ?? '') : ''),
  })
  if (!saved) {
    return
  }
  await loadFunnels()
  // A missing id (unexpected insert answer) keeps the current selection
  // rather than blanking the pane.
  if (saved._id) {
    selectedFunnelId.value = saved._id
  }
}

/** The list hands the website relation expanded; the write path wants the
 * bare id again. */
function bareWebsiteId(funnel: MarketingFunnelListItem): string {
  return typeof funnel.websiteId === 'object' ? funnel.websiteId._id : funnel.websiteId
}

async function openEdit(): Promise<void> {
  const funnel = selectedFunnel.value
  if (!funnel) {
    return
  }
  const saved = await openFunnelForm({
    title: t('page.marketing.funnels.edit_title'),
    websiteId: bareWebsiteId(funnel),
    fetchUrl: `${FUNNELS_TABLE_BASE}/get?id=${encodeURIComponent(funnel._id)}`,
    submitUrl: `${FUNNELS_TABLE_BASE}/edit?id=${encodeURIComponent(funnel._id)}`,
    submitUrlMethod: 'PUT',
    resolveId: () => funnel._id,
  })
  if (!saved) {
    return
  }
  await loadFunnels()
  refreshToken.value++
}

/** Lifecycle transition from the detail pane: a full edit write, because the
 * data-api's mandatory fields all travel on every edit. */
async function changeStatus(target: MarketingExperimentStatus): Promise<void> {
  const funnel = selectedFunnel.value
  const experiment = selectedExperiment.value
  if (!funnel || !experiment) {
    return
  }
  try {
    await api.updateFunnel(funnel._id, {
      websiteId: bareWebsiteId(funnel),
      name: funnel.name,
      steps: parseFunnelStepsValue(funnel.steps),
      conversionWindowHours: funnel.conversionWindowHours,
      experiment: { ...experiment, status: target },
    })
    toast.add({
      color: 'success',
      title: t('page.marketing.funnels.status_updated'),
    })
  }
  catch {
    toast.add({
      color: 'error',
      title: t('page.marketing.funnels.status_error'),
    })
  }
  await loadFunnels()
  refreshToken.value++
}

async function onDeleted(): Promise<void> {
  // Clearing first lets the list watcher land on the first survivor once the
  // reload answers.
  selectedFunnelId.value = undefined
  await loadFunnels()
}
</script>

<template>
  <div class="space-y-6 p-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-xl font-semibold">{{ t('page.marketing.funnels.title') }}</h1>
        <p class="text-sm text-muted">{{ t('page.marketing.funnels.subtitle') }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <USelect
          v-if="websites.length > 1"
          v-model="selectedWebsiteId"
          :items="websiteItems"
          class="w-56"
        />
        <DmsPeriodSelector
          :id="PERIOD_SCOPE"
          :component-id="childId('period')"
          :page-id="props.pageId"
          :default-preset="initialPreset"
          :presets="MARKETING_PERIOD_PRESETS"
          :comparisons="['none']"
          :show-range-label="false"
        />
        <UButton
          v-if="selectedWebsiteId"
          icon="i-ph-plus"
          size="sm"
          :label="t('page.marketing.funnels.new')"
          @click="openCreate"
        />
      </div>
    </div>

    <div v-if="failed" class="flex flex-col items-start gap-3">
      <UAlert
        color="error"
        variant="subtle"
        icon="i-ph-warning-circle"
        :title="t('page.marketing.funnels.error')"
        :description="t('page.marketing.funnels.error_hint')"
      />
      <UButton
        icon="i-ph-arrow-clockwise"
        :label="t('page.marketing.funnels.retry')"
        color="neutral"
        variant="subtle"
        size="sm"
        @click="reload"
      />
    </div>

    <USkeleton v-else-if="loadingWebsites" class="h-96 w-full" />

    <DmsMarketingNoWebsiteState
      v-else-if="websites.length === 0"
      icon="i-ph-globe"
      :title="t('page.marketing.funnels.no_website.title')"
      :description="t('page.marketing.funnels.no_website.description')"
      @create="createWebsite"
    />

    <div
      v-else-if="!loadingFunnels && funnels.length === 0"
      class="flex flex-col items-start gap-3"
    >
      <UAlert
        icon="i-ph-funnel"
        :title="t('page.marketing.funnels.empty.title')"
        :description="t('page.marketing.funnels.empty.description')"
      />
      <UButton
        icon="i-ph-plus"
        :label="t('page.marketing.funnels.new')"
        @click="openCreate"
      />
    </div>

    <DmsMasterDetail
      v-else
      v-model="selectedFunnelId"
      :items="listItems"
      :list-label="t('page.marketing.funnels.list')"
    >
      <DmsMarketingFunnelDetail
        v-if="selectedFunnelId && selectedFunnel"
        :funnel-id="selectedFunnelId"
        :funnel-name="selectedFunnel.name"
        :experiment="selectedExperiment"
        :period="period"
        :refresh-token="refreshToken"
        @edit="openEdit"
        @deleted="onDeleted"
        @status-changed="changeStatus"
      />
      <div v-else class="p-8 text-center text-sm text-muted">
        {{ t('page.marketing.funnels.select_hint') }}
      </div>
    </DmsMasterDetail>
  </div>
</template>
