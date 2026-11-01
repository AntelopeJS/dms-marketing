import { computed } from 'vue'
import { draftIssues, type DraftField } from '../../utils/funnel-draft'
import {
  type MarketingExperiment,
  saveFunnel,
} from '../../composables/useMarketingApi'
import { funnelLink, funnelsLink } from '../../composables/useMarketingRoutes'
import { useContextLink } from '../../composables/useContextLink'
import type { ComputedRef, Ref } from 'vue'
import type { useDmsRouter, useI18n } from '#dms/frontend-module'
import type { useCopyDraft } from '../../composables/useCopyDraft'
import type { useMarketingApi } from '../../composables/useMarketingApi'
import type { VariationDraft } from '../types/funnelBuilder'
import type { useDraftLoad } from './useDraftLoad'
import type { useDraftPreview } from './useDraftPreview'

/** How `FunnelBuilder` leaves: saving the draft (its issues shown first, a started test's goal change confirmed), discarding it, and the links and guards around both. */
export function useDraftSave(
  frozen: ComputedRef<boolean>,
  objectiveOf: ReturnType<typeof useDraftLoad>['objectiveOf'],
  values: () => FunnelDraftValues,
  savedObjective: Ref<string>,
  fieldErrors: ReturnType<typeof useFieldErrors>,
  flaggedStep: Ref<number | null>,
  steps: Ref<StepDraft[]>,
  flaggedVariation: Ref<number | null>,
  variations: Ref<VariationDraft[]>,
  t: ReturnType<typeof useI18n>['t'],
  splitEnabled: Ref<boolean>,
  original: Ref<MarketingExperiment | null>,
  experimentKey: Ref<string>,
  confirm: ReturnType<typeof useConfirm>['confirm'],
  saving: Ref<boolean>,
  websiteId: Ref<string>,
  name: Ref<string>,
  validSteps: ReturnType<typeof useDraftPreview>['validSteps'],
  windowHours: Ref<number | string>,
  api: ReturnType<typeof useMarketingApi>,
  funnelId: string,
  copy: ReturnType<typeof useCopyDraft>,
  toast: ReturnType<typeof useToast>,
  router: ReturnType<typeof useDmsRouter>,
  clearStepError: () => void,
  clearVariationError: () => void,
  applyValues: (next: FunnelDraftValues) => void,
  baseline: ReturnType<typeof useFormDirty>['baseline'],
  isEdit: boolean,
  sourceId: string,
  confirmLeave: ReturnType<typeof useUnsavedChanges>['confirmLeave'],
  websites: ReturnType<typeof useDraftLoad>['websites'],
) {
  /** The steps or the window of a started test differ from the saved ones:
   * saving re-scores the whole test against the new goal. */
  const objectiveChanged = computed(
    () => frozen.value && objectiveOf(values()) !== savedObjective.value,
  )

  // --- Validation and save -------------------------------------------------------

  async function showDraftIssues(): Promise<boolean> {
    const issues = draftIssues(values(), frozen.value)
    const fields = Object.keys(issues) as DraftField[]
    if (fields.length === 0) {
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
    for (const field of fields) {
      const issue = issues[field]!
      fieldErrors.errors[field] = t(
        `page.marketing.builder.errors.${issue.message}`,
        issue.params ?? {},
      )
    }
    await fieldErrors.focus(fields[0]!)
    return true
  }

  function experimentPayload(): MarketingExperiment | null {
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
        weight: arm.weight as number,
      })),
      runs: original.value?.runs ?? [],
    }
  }

  function confirmObjectiveChange(): Promise<boolean> {
    return confirm({
      title: t('page.marketing.builder.objective_confirm.title'),
      description: t('page.marketing.builder.objective_confirm.description'),
      confirmLabel: t('page.marketing.builder.objective_confirm.confirm'),
      cancelLabel: t('page.marketing.builder.objective_confirm.cancel'),
      color: 'warning',
      icon: 'i-ph-warning',
    })
  }

  async function save(): Promise<void> {
    // Several clicks in one tick would each create a funnel.
    if (saving.value) {
      return
    }
    saving.value = true
    try {
      if (await showDraftIssues()) {
        return
      }
      if (objectiveChanged.value && !(await confirmObjectiveChange())) {
        return
      }
      const input = {
        websiteId: websiteId.value,
        name: name.value.trim(),
        steps: validSteps.value,
        conversionWindowHours: windowHours.value as number,
        experiment: experimentPayload(),
      }
      const id = await saveFunnel(api, input, funnelId)
      // Clean before leaving, or the leave guard would ask: a saved copy is
      // no copy any more.
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

  /** Back to what the page opened on. A Duplicate opened on its copy, which
   * stays a change to save: discarding it drops the copy and leaves, with
   * nothing left to hold the navigation. */
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

  /** A link out of the builder, on the website and period it was opened from. */
  const inContext = useContextLink()

  const backLink = computed(() => {
    if (isEdit) {
      return inContext(funnelLink(funnelId))
    }
    return inContext(sourceId ? funnelLink(sourceId) : funnelsLink())
  })

  /** `remount` for another builder URL: the same page otherwise stays
   * mounted on the funnel it opened with. */
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
