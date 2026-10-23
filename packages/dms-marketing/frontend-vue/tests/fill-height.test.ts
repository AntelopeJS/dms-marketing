import { describe, expect, it } from 'vitest'
import {
  fillHeight,
  MIN_FILL_HEIGHT,
  trailingExtent,
  type TrailingLevel,
} from '../app/utils/fill-height'

describe('the height the pages panes fill', () => {
  it('is what the viewport leaves below their top and above what follows', () => {
    // 1000 px window, panes from 290 px, a 40 px note and padding after them.
    expect(fillHeight({ viewHeight: 1000, top: 290, trailing: 40 })).toBe(670)
  })

  it('grows and shrinks with the viewport alone', () => {
    const at = (viewHeight: number) =>
      fillHeight({ viewHeight, top: 274, trailing: 37 })
    expect(at(900)).toBe(589)
    expect(at(1100)).toBe(789)
    expect(at(900)).toBe(589)
  })

  it('stops shrinking at its floor', () => {
    expect(fillHeight({ viewHeight: 600, top: 290, trailing: 40 })).toBe(
      MIN_FILL_HEIGHT,
    )
  })
})

describe('what the content lays out after the panes', () => {
  it('is how far the following siblings reach, plus the closing padding', () => {
    expect(
      trailingExtent([
        // The panes, then a note 16 px below them, 40 px high.
        { bottom: 800, marginBottom: 0, following: [856], closing: 0 },
        // Their block ends the content, which closes on 24 px of padding.
        { bottom: 856, marginBottom: 0, following: [], closing: 24 },
      ]),
    ).toBe(80)
  })

  it('counts the bottom margin of a box nothing follows', () => {
    expect(
      trailingExtent([
        { bottom: 500, marginBottom: 12, following: [], closing: 8 },
      ]),
    ).toBe(20)
  })

  it('ignores siblings laid out beside the box rather than after it', () => {
    expect(
      trailingExtent([
        { bottom: 500, marginBottom: 0, following: [320], closing: 0 },
      ]),
    ).toBe(0)
  })
})

/**
 * An app shell, as the pages surface sits in it: a scroll viewport with
 * 24 px of padding, a wrapper stretched to at least the viewport
 * (`min-height: 100%`), a 250 px header, then the panes' block — the panes
 * and a 40 px note 16 px below them.
 */
function shell(viewHeight: number, paneHeight: number): TrailingLevel[] {
  const top = 274
  const panesBottom = top + paneHeight
  const blockBottom = panesBottom + 16 + 40
  const wrapperBottom = Math.max(blockBottom, viewHeight - 24)
  return [
    {
      bottom: panesBottom,
      marginBottom: 0,
      following: [blockBottom],
      closing: 0,
    },
    { bottom: blockBottom, marginBottom: 0, following: [], closing: 0 },
    { bottom: wrapperBottom, marginBottom: 0, following: [], closing: 24 },
  ]
}

/** One measurement, as a resize triggers it: from the panes' current height. */
function measure(viewHeight: number, paneHeight: number): number {
  return fillHeight({
    viewHeight,
    top: 274,
    trailing: trailingExtent(shell(viewHeight, paneHeight)),
  })
}

describe('the panes in a shell that stretches its content', () => {
  it('fill a fresh window', () => {
    expect(measure(900, 0)).toBe(546)
  })

  it('grow with the window in one measurement', () => {
    // The content is shorter than the grown viewport: the wrapper's empty
    // space below the panes is not content after them.
    expect(measure(1100, measure(900, 0))).toBe(746)
  })

  it('shrink with the window in one measurement', () => {
    expect(measure(900, measure(1100, 0))).toBe(546)
  })

  it('settle at once: measuring again changes nothing', () => {
    const height = measure(1100, 546)
    expect(measure(1100, height)).toBe(height)
  })
})
