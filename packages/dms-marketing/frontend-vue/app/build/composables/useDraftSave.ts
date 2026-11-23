import { computed } from 'vue'
import {
  draftIssueList,
  draftIssues,
  type DraftField,
  type FunnelDraftValues,
} from '../../utils/funnel-draft'
import { saveFunnel } from '../../composables/useMarketingApi'
import { funnelLink, funnelsLink } from '../../composables/useMarketingRoutes'
import { useContextLink } from '../../composables/useContextLink'
import type { ComputedRef, Ref } from 'vue'
import type { useDmsRouter, useI18n } from '#dms/frontend-module'
import type { useCopyDraft } from '../../composables/useCopyDraft'
import type {
  useMarketingApi,
  MarketingExperiment,
} from '../../composables/useMarketingApi'
import type { StepDraft, VariationDraft } from '../types/funnelBuilder'
import type { useDraftLoad } from './useDraftLoad'
import type { useDraftPreview } from './useDraftPreview'

/** What `useDraftSave` takes from the component that calls it. */
export interface DraftSaveOptions {
  frozen: ComputedRef<boolean>
  objectiveOf: ReturnType<typeof useDraftLoad>['objectiveOf']
  values: () => FunnelDraftValues
  savedObjective: Ref<string>
  fieldErrors: ReturnType<typeof useFieldErrors<DraftField>>
  flaggedStep: Ref<number | null>
  steps: Ref<StepDraft[]>
  flaggedVariation: Ref<number | null>
  variations: Ref<VariationDraft[]>
  t: ReturnType<typeof useI18n>['t']
  splitEnabled: Ref<boolean>
  original: Ref<MarketingExperiment | null>
  experimentKey: Ref<string>
  confirm: ReturnType<typeof useConfirm>['confirm']
  saving: Ref<boolean>
  websiteId: Ref<string>
  name: Ref<string>
  validSteps: ReturnType<typeof useDraftPreview>['validSteps']
  windowHours: Ref<number | string>
  api: ReturnType<typeof useMarketingApi>
  funnelId: string
  copy: ReturnType<typeof useCopyDraft>
  toast: ReturnType<typeof useToast>
  router: ReturnType<typeof useDmsRouter>
  clearStepError: () => void
  clearVariationError: () => void
  applyValues: (next: FunnelDraftValues) => void
  baseline: ReturnType<typeof useFormDirty<FunnelDraftValues>>['baseline']
  isEdit: boolean
  sourceId: string
  confirmLeave: ReturnType<typeof useUnsavedChanges>['confirmLeave']
  websites: ReturnType<typeof useDraftLoad>['websites']
}

/**
 * How `FunnelBuilder` leaves: saving the draft (its issues shown first, a
 * started test's goal change confirmed), discarding it, and the links and
 * guards around both.
 *
 * Saving re-scores a whole started test against the new goal when its steps or
 * window differ from the saved ones. Several clicks in one tick would each
 * create a funnel, so a save in flight refuses the next. The copy is settled
 * before leaving, or the leave guard would ask. Discarding returns to what the
 * page opened on; a Duplicate opened on its copy, which stays a change to save,
 * so discarding drops the copy and leaves with nothing left to hold the
 * navigation. `leave` takes `remount` for another builder URL, as the same page
 * otherwise stays mounted on the funnel it opened with.
 */
/** The draft's issues put under their fields; true when there was one. */
async function showDraftIssues(options: DraftSaveOptions): Promise<boolean> {
  const {
    frozen,
    values,
    fieldErrors,
    flaggedStep,
    steps,
    flaggedVariation,
    variations,
    t,
  } = options
  const issues = draftIssues(values(), frozen.value)
  const [first, ...others] = draftIssueList(issues)
  if (!first) {
    return false
  }
  fieldErrors.clear()
  flaggedStep.value =
    issues.steps?.index === undefined
      ? null
      : (steps.value[issues.steps.index]?.uid ?? null)
  flaggedVariation.value =
    issues.variations?.index === undefined
      ? null
      : (variations.value[issues.variations.index]?.uid ?? null)
  for (const { field, issue } of [first, ...others]) {
    fieldErrors.errors[field] = t(
      `page.marketing.builder.errors.${issue.message}`,
      issue.params ?? {},
    )
  }
  await fieldErrors.focus(first.field)
  return true
}

function experimentPayload(
  options: DraftSaveOptions,
): MarketingExperiment | null {
  const { splitEnabled, frozen, original, experimentKey, variations } = options
  if (!splitEnabled.value) {
    return null
  }
  if (frozen.value && original.value) {
    return original.value
  }
  return {
    key: experimentKey.value.trim(),
    status: original.value?.status ?? 'draft',
    variations: variations.value.map((arm) => ({
      key: arm.key.trim(),
      weight: Number(arm.weight),
    })),
    runs: original.value?.runs ?? [],
  }
}

function confirmObjectiveChange(options: DraftSaveOptions): Promise<boolean> {
  const { confirm, t } = options
  return confirm({
    title: t('page.marketing.builder.objective_confirm.title'),
    description: t('page.marketing.builder.objective_confirm.description'),
    confirmLabel: t('page.marketing.builder.objective_confirm.confirm'),
    cancelLabel: t('page.marketing.builder.objective_confirm.cancel'),
    color: 'warning',
    icon: 'i-ph-warning',
  })
}

/**
 * How `FunnelBuilder` leaves: saving the draft (its issues shown first, a
 * started test's goal change confirmed), discarding it, and the links and
 * guards around both.
 *
 * Saving re-scores a whole started test against the new goal when its steps or
 * window differ from the saved ones. Several clicks in one tick would each
 * create a funnel, so a save in flight refuses the next. The copy is settled
 * before leaving, or the leave guard would ask. Discarding returns to what the
 * page opened on; a Duplicate opened on its copy, which stays a change to save,
 * so discarding drops the copy and leaves with nothing left to hold the
 * navigation. `leave` takes `remount` for another builder URL, as the same page
 * otherwise stays mounted on the funnel it opened with.
 */
export function useDraftSave(options: DraftSaveOptions) {
  const {
    frozen,
    objectiveOf,
    values,
    savedObjective,
    fieldErrors,
    t,
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
  } = options
  const objectiveChanged = computed(
    () => frozen.value && objectiveOf(values()) !== savedObjective.value,
  )

  async function save(): Promise<void> {
    if (saving.value) {
      return
    }
    saving.value = true
    try {
      if (await showDraftIssues(options)) {
        return
      }
      if (objectiveChanged.value && !(await confirmObjectiveChange(options))) {
        return
      }
      const input = {
        websiteId: websiteId.value,
        name: name.value.trim(),
        steps: validSteps.value,
        conversionWindowHours: Number(windowHours.value),
        experiment: experimentPayload(options),
      }
      const id = await saveFunnel(api, input, funnelId)
      copy.settle()
      toast.add({
        color: 'success',
        title: t('page.marketing.builder.saved'),
      })
      await router.push(inContext(id ? funnelLink(id) : funnelsLink()))
    } catch (error) {
      await fieldErrors.handleApiError(error, {
        toastTitle: 'page.marketing.builder.save_error',
      })
    } finally {
      saving.value = false
    }
  }

  function discard(): void {
    clearStepError()
    clearVariationError()
    fieldErrors.clear()
    if (copy.isCopy.value) {
      copy.settle()
      void router.push(backLink.value)
      return
    }
    applyValues(baseline.value)
  }

  const inContext = useContextLink()

  const backLink = computed(() => {
    if (isEdit) {
      return inContext(funnelLink(funnelId))
    }
    return inContext(sourceId ? funnelLink(sourceId) : funnelsLink())
  })

  async function leave(href: string, remount = false): Promise<void> {
    if (await confirmLeave()) {
      await router.push(href, remount ? { preserveState: false } : undefined)
    }
  }

  const websiteItems = computed(() =>
    websites.value.map((site) => ({
      value: site.id,
      label: `${site.name} · ${site.domain}`,
    })),
  )

  return {
    objectiveChanged,
    save,
    discard,
    inContext,
    backLink,
    leave,
    websiteItems,
  }
}
