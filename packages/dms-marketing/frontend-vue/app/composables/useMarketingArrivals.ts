import { watch } from 'vue'

/**
 * Has every block of the page read again on each arrival of `topic`, for
 * stock blocks that take no `realtimeTopic` of their own (the KPI cards):
 * `refreshLivePageBlocks()`, which the page's live gate caps at its rate. Only
 * while `isMoving()` (the period reaches today on the page's website): past
 * days do not move. Paused, an arrival is only noted, never counted (each
 * block would count it once), and Resume asks once.
 */
export function useMarketingArrivals(
  topic: string,
  isMoving: () => boolean,
): void {
  const live = usePageLive()
  let missedWhilePaused = false

  useRealtimeTopic(topic, (event) => {
    // Presence snapshots ride the topics too: they carry no `type`.
    if (!('type' in event) || !isMoving()) {
      return
    }
    if (live.isPaused.value) {
      missedWhilePaused = true
    } else {
      refreshLivePageBlocks()
    }
  })

  watch(live.isPaused, (paused) => {
    if (!paused && missedWhilePaused) {
      missedWhilePaused = false
      refreshLivePageBlocks()
    }
  })
}
