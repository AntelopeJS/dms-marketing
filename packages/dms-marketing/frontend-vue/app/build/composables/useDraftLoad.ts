import {
  useFunnelRead,
  useContextOnDemand,
} from '../../composables/useMarketingReads'
import { parseExperimentValue } from '../../composables/useExperiment'
import {
  type FunnelDraftValues,
  withRequestedSplit,
  MAX_NAME_LENGTH,
  templateSteps,
} from '../../utils/funnel-draft'
import { parseFunnelStepsValue } from '../../composables/useFunnelSteps'
import { type MarketingExperiment } from '../../composables/useMarketingApi'
import { ref, onMounted } from 'vue'
import { type ContextWebsite } from '../../composables/useMarketingContext'
import type { Ref } from 'vue'
import type { useDmsRoute, useI18n } from '#dms/frontend-module'
import type { useCopyDraft } from '../../composables/useCopyDraft'
import type { VariationDraft } from '../types/funnelBuilder'

/** How `FunnelBuilder` fills its draft once mounted: the funnel being edited or copied, a template, and the websites it can target. */
export function useDraftLoad(
  funnelId: string,
  sourceId: string,
  values: () => FunnelDraftValues,
  applyValues: (next: FunnelDraftValues) => void,
  route: ReturnType<typeof useDmsRoute>,
  original: Ref<MarketingExperiment | null>,
  savedObjective: Ref<string>,
  t: ReturnType<typeof useI18n>['t'],
  copy: ReturnType<typeof useCopyDraft>,
  queryParam: (key: string) => string,
  websiteId: Ref<string>,
  loading: Ref<boolean>,
  loadFailed: Ref<'not_found' | 'error' | null>,
  isEdit: boolean,
  steps: Ref<StepDraft[]>,
  uid: () => number,
  markClean: () => void,
  HTTP_NOT_FOUND: number,
) {
  const consumeRefusal = useReadOnlyRefusal()
  // --- Loading -------------------------------------------------------------------

  // The definition edited, or the one a Duplicate copies.
  const readDefinition = useFunnelRead(funnelId || sourceId)
  const readContext = useContextOnDemand()

  /** A stored definition as the form holds it. */
  async function fetchDefinition() {
    const row = await readDefinition()
    const experiment = parseExperimentValue(row.experiment)
    const draft: FunnelDraftValues = {
      name: row.name,
      websiteId:
        typeof row.websiteId === 'string' ? row.websiteId : row.websiteId._id,
      steps: parseFunnelStepsValue(row.steps),
      windowHours: row.conversionWindowHours,
      split: experiment !== null,
      experimentKey: experiment?.key ?? '',
      variations: experiment?.variations ?? values().variations,
    }
    const stored: MarketingExperiment | null = experiment && {
      key: experiment.key,
      status: experiment.status ?? 'draft',
      variations: experiment.variations,
      runs: experiment.runs,
    }
    return { draft, experiment: stored }
  }

  function objectiveOf(draft: FunnelDraftValues): string {
    const kept = draft.steps
      .map((step) => ({ kind: step.kind, value: step.value.trim() }))
      .filter((step) => step.value !== '')
    return JSON.stringify([kept, draft.windowHours])
  }

  async function loadExisting(): Promise<void> {
    const { draft, experiment } = await fetchDefinition()
    applyValues(withRequestedSplit(draft, route.query.split))
    original.value = experiment
    savedObjective.value = objectiveOf(draft)
  }

  /** Duplicate: the copy is a new draft, unsaved until the user saves it — its
   * experiment key must change, keys being unique per site. */
  async function loadCopy(): Promise<void> {
    const { draft } = await fetchDefinition()
    applyValues({
      ...draft,
      name: t('page.marketing.builder.copy_name', { name: draft.name }).slice(
        0,
        MAX_NAME_LENGTH,
      ),
      experimentKey: '',
    })
    copy.open()
  }

  // The builder sits outside the context bar: it reads the website list itself,
  // and starts a new funnel on the website of the page it was opened from, else
  // on the member's selection.
  const websites = ref<ContextWebsite[]>([])

  async function loadWebsites(): Promise<void> {
    const payload = await readContext()
    websites.value = payload.websites
    const linked = queryParam('website')
    websiteId.value ||=
      (payload.websites.some((site) => site.id === linked) ? linked : null) ??
      payload.selectedId ??
      ''
  }

  async function load(): Promise<void> {
    loading.value = true
    loadFailed.value = null
    try {
      // The funnel first: its site then wins over the context's, and the
      // suggestions are read once, for the right site.
      if (isEdit) {
        await loadExisting()
      }
      await loadWebsites().catch(() => undefined)
      const template = templateSteps(route.query.steps)
      if (!isEdit && template.length > 0) {
        steps.value = template.map((step) => ({ uid: uid(), ...step }))
      }
      // The starting point: what the page opened on. A copy is applied after
      // it, so it counts as a change to save.
      markClean()
      if (sourceId) {
        await loadCopy()
      }
    } catch (error) {
      if (consumeRefusal(error)) {
        return
      }
      loadFailed.value =
        apiErrorStatus(error) === HTTP_NOT_FOUND ? 'not_found' : 'error'
    } finally {
      loading.value = false
    }
  }

  onMounted(load)

  return { objectiveOf, websites, load }
}
