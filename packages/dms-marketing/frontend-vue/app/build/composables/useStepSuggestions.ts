import type { MarketingFunnelSuggestions } from '../../composables/useMarketingApi'
import { useFunnelSuggestions } from '../../composables/useMarketingReads'
import { computed, ref } from 'vue'
import type { StepDraft } from '../types/funnelBuilder'
import type { Ref } from 'vue'

/**
 * The suggestions of `FunnelBuilder`'s step inputs: the site's pages and
 * events, the list under the focused input and its keyboard.
 *
 * They are read once the site is known (the context, or the funnel being
 * edited). The list is a combobox: arrows move through it, Enter picks, Escape
 * closes it until the step is typed in again, and the blur is late enough for a
 * click on a suggestion to land first.
 */
export function useStepSuggestions(
  websiteId: Ref<string>,
  SUGGESTIONS_SHOWN: number,
  clearStepError: () => void,
  STEP_CONTROL_PREFIX: string,
) {
  const NO_SUGGESTIONS: MarketingFunnelSuggestions = { pages: [], events: [] }

  const suggestionsRead = useFunnelSuggestions(websiteId)
  const suggestions = computed(() =>
    suggestionsRead.error.value
      ? NO_SUGGESTIONS
      : (suggestionsRead.data.value ?? NO_SUGGESTIONS),
  )

  const focusedStep = ref<number | null>(null)
  const dismissedStep = ref<number | null>(null)
  const activeOption = ref(-1)

  function matchesFor(step: StepDraft) {
    const pool =
      step.kind === 'url' ? suggestions.value.pages : suggestions.value.events
    const needle = step.value.trim().toLowerCase()
    return pool
      .filter((entry) => !needle || entry.value.toLowerCase().includes(needle))
      .filter((entry) => entry.value !== step.value)
      .slice(0, SUGGESTIONS_SHOWN)
  }

  function listOpen(step: StepDraft): boolean {
    return (
      focusedStep.value === step.uid &&
      dismissedStep.value !== step.uid &&
      matchesFor(step).length > 0
    )
  }

  function focusStep(step: StepDraft): void {
    focusedStep.value = step.uid
    activeOption.value = -1
  }

  const BLUR_DELAY_MS = 150

  function blurStep(step: StepDraft): void {
    setTimeout(() => {
      if (focusedStep.value === step.uid) {
        focusedStep.value = null
      }
    }, BLUR_DELAY_MS)
  }

  function typeStep(): void {
    dismissedStep.value = null
    activeOption.value = -1
    clearStepError()
  }

  function pick(step: StepDraft, value: string): void {
    step.value = value
    dismissedStep.value = step.uid
    activeOption.value = -1
    clearStepError()
  }

  function onStepKeydown(event: KeyboardEvent, step: StepDraft): void {
    if (!listOpen(step)) {
      return
    }
    const count = matchesFor(step).length
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const offset = event.key === 'ArrowDown' ? 1 : -1
      activeOption.value = (activeOption.value + offset + count) % count
    } else if (event.key === 'Enter' && activeOption.value >= 0) {
      event.preventDefault()
      const active = matchesFor(step)[activeOption.value]
      if (active) {
        pick(step, active.value)
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      dismissedStep.value = step.uid
    }
  }

  function optionId(step: StepDraft, index: number): string {
    return `${STEP_CONTROL_PREFIX}${step.uid}-option-${index}`
  }

  return {
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
  }
}
