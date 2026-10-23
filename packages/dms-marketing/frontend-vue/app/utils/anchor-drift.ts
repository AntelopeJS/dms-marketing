/**
 * How many anchored clicks aim at elements the snapshot no longer has: the
 * sign the page changed since it was captured. Such a click is drawn at
 * its document fraction instead of on its element (see PagePreview), which
 * is still a position, not a loss — so the warning waits for a share and a
 * count that say more than one removed button.
 */

/** Share of the anchored clicks past which the warning shows. */
export const DRIFT_MIN_SHARE = 0.1
/** And the fewest clicks it takes: two clicks out of ten are not a trend. */
export const DRIFT_MIN_CLICKS = 5

interface DriftPoint {
  weight: number
  anchor?: { selector: string; nth: number }
}

export interface AnchorDrift {
  /** Clicks carrying an element anchor — the ones that can drift. */
  anchored: number
  /** Of those, the clicks whose element is not in the snapshot. */
  missing: number
  /** missing / anchored, 0 without anchored clicks. */
  share: number
  /** Past both thresholds: worth a warning. */
  significant: boolean
}

/**
 * `isMissing` answers whether an anchor's element is absent from the
 * snapshot document — absent, not merely hidden at the layout on screen: a
 * phone menu clicked by phone visitors is in a desktop capture, just not
 * drawn, and is no sign of change.
 */
export function anchorDrift(
  points: DriftPoint[],
  isMissing: (anchor: { selector: string; nth: number }) => boolean,
): AnchorDrift {
  let anchored = 0
  let missing = 0
  for (const point of points) {
    if (!point.anchor) {
      continue
    }
    anchored += point.weight
    if (isMissing(point.anchor)) {
      missing += point.weight
    }
  }
  const share = anchored > 0 ? missing / anchored : 0
  return {
    anchored,
    missing,
    share,
    significant: missing >= DRIFT_MIN_CLICKS && share >= DRIFT_MIN_SHARE,
  }
}
