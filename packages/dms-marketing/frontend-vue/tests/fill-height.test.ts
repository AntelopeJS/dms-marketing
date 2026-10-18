import { describe, expect, it } from 'vitest'
import { fillHeight, MIN_FILL_HEIGHT } from '../app/utils/fill-height'

describe('the height the pages panes fill', () => {
  it('is what the viewport leaves below their top and above what follows', () => {
    // 1000 px window, panes from 290 px, a 40 px note and padding after them.
    expect(
      fillHeight({
        viewHeight: 1000,
        top: 290,
        bottom: 900,
        contentHeight: 940,
      }),
    ).toBe(670)
  })

  it('does not depend on the panes current height', () => {
    const short = fillHeight({
      viewHeight: 1000,
      top: 290,
      bottom: 600,
      contentHeight: 640,
    })
    const tall = fillHeight({
      viewHeight: 1000,
      top: 290,
      bottom: 3000,
      contentHeight: 3040,
    })
    expect(short).toBe(tall)
  })

  it('stops shrinking at its floor', () => {
    expect(
      fillHeight({
        viewHeight: 600,
        top: 290,
        bottom: 900,
        contentHeight: 940,
      }),
    ).toBe(MIN_FILL_HEIGHT)
  })
})
