import { describe, expect, it } from 'vitest'
import {
  unrollScrollRoot,
  type UnrollElement,
  type UnrollStyle,
} from '../app/utils/snapshotScrollRoot'

interface FakeElement extends UnrollElement {
  name: string
  parentElement: FakeElement | null
  computed: UnrollStyle
  set: Record<string, string>
}

function element(
  name: string,
  parent: FakeElement | null,
  computed: Partial<UnrollStyle> = {},
): FakeElement {
  const set: Record<string, string> = {}
  return {
    name,
    parentElement: parent,
    computed: {
      position: 'static',
      overflowX: 'visible',
      display: 'block',
      flexDirection: 'row',
      ...computed,
    },
    set,
    style: {
      setProperty(property, value, priority) {
        expect(priority).toBe('important')
        set[property] = value
      },
    },
  }
}

describe('snapshot scroll root', () => {
  // The dashboard shape: a fixed shell, a sidebar row, a column panel whose
  // body scrolls.
  const html = element('html', null)
  const body = element('body', html, { overflowX: 'hidden' })
  const shell = element('shell', body, {
    position: 'fixed',
    overflowX: 'hidden',
    display: 'flex',
  })
  const panel = element('panel', shell, {
    display: 'flex',
    flexDirection: 'column',
  })
  const scroller = element('scroller', panel, { overflowX: 'hidden' })
  unrollScrollRoot(scroller, (node) => node.computed)

  it('lets the scroll root and every ancestor grow with the content', () => {
    for (const node of [scroller, panel, shell, body, html]) {
      expect(node.set.height, node.name).toBe('auto')
      expect(node.set['max-height'], node.name).toBe('none')
      expect(node.set['overflow-y'], node.name).toBe('visible')
    }
  })

  it('keeps a horizontal clip without making a scroll container', () => {
    expect(scroller.set['overflow-x']).toBe('clip')
    expect(body.set['overflow-x']).toBe('clip')
    expect(panel.set['overflow-x']).toBeUndefined()
  })

  it('puts a fixed shell back in the document, unpinned at the bottom', () => {
    expect(shell.set.position).toBe('absolute')
    expect(shell.set.bottom).toBe('auto')
    expect(panel.set.position).toBeUndefined()
  })

  it('touches the flex basis in a column only', () => {
    expect(scroller.set['flex-basis']).toBe('auto')
    expect(scroller.set['flex-shrink']).toBe('0')
    // The panel is an item of a row: its basis is a width.
    expect(panel.set['flex-basis']).toBeUndefined()
  })
})
