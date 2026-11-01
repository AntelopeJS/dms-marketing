import { computed } from 'vue'
import { type VariationDraft } from '../types/funnelBuilder'
import {
  MAX_VARIATIONS,
  localizedSnippetComments,
} from '../../utils/funnel-draft'
import type { Ref } from 'vue'
import type { useI18n } from '#dms/frontend-module'
import type { useDraftPreview } from './useDraftPreview'

/** The step kinds of `FunnelBuilder`, the variations of its split (their shares, letters and rows) and the comments of its snippet. */
export function useDraftVariations(
  t: ReturnType<typeof useI18n>['t'],
  variations: Ref<VariationDraft[]>,
  PERCENT: number,
  clearVariationError: () => void,
  uid: () => number,
  LETTER_A: number,
  validSteps: ReturnType<typeof useDraftPreview>['validSteps'],
) {
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

  function servedWeight(arm: VariationDraft): number {
    return typeof arm.weight === 'number' && arm.weight > 0 ? arm.weight : 0
  }

  const totalWeight = computed(() =>
    variations.value.reduce((sum, arm) => sum + servedWeight(arm), 0),
  )

  function share(arm: VariationDraft): number {
    return totalWeight.value > 0
      ? (servedWeight(arm) / totalWeight.value) * PERCENT
      : 0
  }

  function addVariation(): void {
    clearVariationError()
    if (variations.value.length < MAX_VARIATIONS) {
      variations.value.push({ uid: uid(), key: '', weight: 1 })
    }
  }

  function removeVariation(index: number): void {
    clearVariationError()
    variations.value.splice(index, 1)
  }

  function letter(index: number): string {
    return String.fromCharCode(LETTER_A + index)
  }

  const firstUrlStep = computed(
    () => validSteps.value.find((step) => step.kind === 'url')?.value ?? '/',
  )

  const snippetComments = computed(() => localizedSnippetComments(t))

  return {
    kindItems,
    share,
    addVariation,
    removeVariation,
    letter,
    firstUrlStep,
    snippetComments,
  }
}
