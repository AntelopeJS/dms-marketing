import { computed, effectScope, nextTick, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMarketingArrivals } from '../app/composables/useMarketingArrivals'

const TOPIC = 'marketing.events'

let paused: Ref<boolean>
let moving: boolean
let handler: ((event: object) => void) | undefined
let refreshes: number

beforeEach(() => {
  paused = ref(false)
  moving = true
  handler = undefined
  refreshes = 0
  vi.stubGlobal('usePageLive', () => ({
    isPaused: computed(() => paused.value),
  }))
  vi.stubGlobal(
    'useRealtimeTopic',
    (topic: string, onEvent: (event: object) => void) => {
      if (topic === TOPIC) {
        handler = onEvent
      }
    },
  )
  vi.stubGlobal('refreshLivePageBlocks', () => {
    refreshes += 1
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function start(): () => void {
  const scope = effectScope()
  scope.run(() => useMarketingArrivals(TOPIC, () => moving))
  return () => scope.stop()
}

const ARRIVAL = { topic: TOPIC, type: 'collected', payload: { count: 3 } }

describe('the arrivals of a page with blocks taking no topic', () => {
  it('asks every block to read, through the live gate, on each arrival', () => {
    const stop = start()
    handler?.(ARRIVAL)
    handler?.({ ...ARRIVAL })
    expect(refreshes).toBe(2)
    stop()
  })

  it('takes a presence snapshot for no arrival', () => {
    const stop = start()
    handler?.({ topic: TOPIC, entries: [] })
    expect(refreshes).toBe(0)
    stop()
  })

  it('reads nothing for a period that ended: past days do not move', () => {
    const stop = start()
    moving = false
    handler?.(ARRIVAL)
    expect(refreshes).toBe(0)
    stop()
  })

  it('freezes while paused, and asks once on resume', async () => {
    const stop = start()
    paused.value = true
    await nextTick()
    handler?.(ARRIVAL)
    handler?.({ ...ARRIVAL })
    // Paused, nothing is asked: the gate would count each block's ask.
    expect(refreshes).toBe(0)
    paused.value = false
    await nextTick()
    expect(refreshes).toBe(1)
    stop()
  })

  it('asks nothing on resume when nothing came in', async () => {
    const stop = start()
    paused.value = true
    await nextTick()
    paused.value = false
    await nextTick()
    expect(refreshes).toBe(0)
    stop()
  })
})
