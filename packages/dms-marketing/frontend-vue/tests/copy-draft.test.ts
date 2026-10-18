import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useCopyDraft } from '../app/composables/useCopyDraft'

/** A form as `useFormDirty` sees it: values against a baseline. */
function form(initial: string) {
  const value = ref(initial)
  const baseline = ref(initial)
  const dirty = computed(() => value.value !== baseline.value)
  const markClean = () => {
    baseline.value = value.value
  }
  const copy = useCopyDraft({ values: () => value.value, dirty, markClean })
  return { value, dirty, copy }
}

describe('a form opened on a copy', () => {
  it('shows the copy as a change to save, but holds no leave until edited', () => {
    const { value, dirty, copy } = form('')
    value.value = 'Copy of checkout'
    copy.open()
    expect(dirty.value).toBe(true)
    expect(copy.unsaved.value).toBe(false)
    value.value = 'Copy of checkout (B)'
    expect(copy.unsaved.value).toBe(true)
    value.value = 'Copy of checkout'
    expect(copy.unsaved.value).toBe(false)
  })

  // QA m8: Cancel on a copy did nothing and the leave stayed held.
  it('drops the copy, edits included: nothing holds the leave after', () => {
    const { value, dirty, copy } = form('')
    value.value = 'Copy of checkout'
    copy.open()
    value.value = 'Edited copy'
    copy.drop()
    expect(copy.isCopy.value).toBe(false)
    expect(dirty.value).toBe(false)
    expect(copy.unsaved.value).toBe(false)
  })
})

describe('a form opened on a stored value', () => {
  it('holds the leave exactly while dirty', () => {
    const { value, copy } = form('Checkout')
    expect(copy.isCopy.value).toBe(false)
    expect(copy.unsaved.value).toBe(false)
    value.value = 'Checkout v2'
    expect(copy.unsaved.value).toBe(true)
  })
})
