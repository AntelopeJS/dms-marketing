import { describe, expect, it } from 'vitest'
import {
  anchorDrift,
  DRIFT_MIN_CLICKS,
  DRIFT_MIN_SHARE,
} from '../app/utils/anchor-drift'

const anchor = (selector: string, nth = 0) => ({ selector, nth })
const gone = new Set(['#old-cta\u00000', '.card\u00002'])
const isMissing = (a: { selector: string; nth: number }) =>
  gone.has(`${a.selector}\u0000${a.nth}`)

describe('anchor drift', () => {
  it('counts the clicks whose element the snapshot lacks, by weight', () => {
    const drift = anchorDrift(
      [
        { weight: 40, anchor: anchor('#buy') },
        { weight: 6, anchor: anchor('#old-cta') },
        { weight: 4, anchor: anchor('.card', 2) },
        // Same selector, an nth the snapshot still has.
        { weight: 10, anchor: anchor('.card', 1) },
        // A click on the document itself cannot drift.
        { weight: 100 },
      ],
      isMissing,
    )
    expect(drift).toEqual({
      anchored: 60,
      missing: 10,
      share: 10 / 60,
      significant: true,
    })
  })

  it('warns from 10 % and 5 clicks, not below either', () => {
    expect(DRIFT_MIN_SHARE).toBe(0.1)
    expect(DRIFT_MIN_CLICKS).toBe(5)
    const at = (missing: number, kept: number) =>
      anchorDrift(
        [
          { weight: missing, anchor: anchor('#old-cta') },
          { weight: kept, anchor: anchor('#buy') },
        ],
        isMissing,
      ).significant
    expect(at(5, 45)).toBe(true) // 10 %, 5 clicks
    expect(at(5, 46)).toBe(false) // under 10 %
    expect(at(4, 0)).toBe(false) // 100 %, but 4 clicks
  })

  it('reads no drift without anchored clicks', () => {
    expect(anchorDrift([{ weight: 9 }], isMissing)).toEqual({
      anchored: 0,
      missing: 0,
      share: 0,
      significant: false,
    })
  })
})
