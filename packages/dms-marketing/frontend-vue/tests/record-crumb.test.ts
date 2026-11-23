import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRecordCrumb } from '../app/composables/useRecordCrumb'

let labels: { path: string; label: string | undefined }[]

beforeEach(() => {
  labels = []
  vi.stubGlobal('usePageRecordLabel', () => ({
    setLabel: (path: string, label: string | undefined) =>
      labels.push({ path, label }),
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the record crumb', () => {
  it("names the page's record once it is loaded, and follows it", async () => {
    const name = ref<string | null>(null)
    useRecordCrumb(() => name.value)
    name.value = 'Checkout'
    await nextTick()
    name.value = 'Pricing to signup'
    await nextTick()
    expect(labels).toEqual([
      { path: '/', label: undefined },
      { path: '/', label: 'Checkout' },
      { path: '/', label: 'Pricing to signup' },
    ])
  })

  it("gives the page's own name back while no record is shown", async () => {
    const name = ref<string | null>('Checkout')
    useRecordCrumb(() => name.value)
    name.value = null
    await nextTick()
    expect(labels.at(-1)).toEqual({ path: '/', label: undefined })
  })
})
