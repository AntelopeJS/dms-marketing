import { computed, ref, type ComputedRef, type Ref } from 'vue'

interface UseCopyDraftOptions<T> {
  /** The form's current values. */
  values: () => T
  /** Whether they differ from the form's baseline (`useFormDirty`). */
  dirty: Ref<boolean> | ComputedRef<boolean>
  /** Makes the current values the baseline (`useFormDirty`). */
  markClean: () => void
}

/**
 * The unsaved state of a form that can open on a copy (a Duplicate). The copy
 * is a change to save, so the save bar shows it from the start; but an
 * untouched copy holds no work to lose: leaving it asks nothing, and closing
 * the tab or a scripted navigation is never held by a "leave page?" prompt.
 * Once the user edits it, it is guarded like any other change.
 */
export function useCopyDraft<T>(options: UseCopyDraftOptions<T>) {
  /** The values the copy opened on; null outside a copy. */
  const copied = ref<string | null>(null)
  const snapshot = () => JSON.stringify(options.values())

  /** Work leaving would lose: what the leave guard watches. */
  const unsaved = computed(() =>
    copied.value === null ? options.dirty.value : snapshot() !== copied.value,
  )

  /** The copy is applied to the form: what is on screen is the copy. */
  function open(): void {
    copied.value = snapshot()
  }

  /** Ends the copy on what is on screen: the form is clean and nothing holds
   * the leave. Throwing it away (with any edit to it) and saving it both end it. */
  function settle(): void {
    copied.value = null
    options.markClean()
  }

  return {
    isCopy: computed(() => copied.value !== null),
    unsaved,
    open,
    settle,
  }
}
