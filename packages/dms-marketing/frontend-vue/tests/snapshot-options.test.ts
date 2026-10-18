import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/marketing-en-GB.json'
import fr from '../i18n/locales/marketing-fr-FR.json'
import {
  changesSnapshotOptions,
  confirmSnapshotChange,
  snapshotDiscardConfirmation,
  snapshotOptionItems,
} from '../app/utils/snapshot-options'

/** A `t` that shows which key, count and plural form were asked for. */
function t(key: string, named: Record<string, unknown> = {}, plural?: number) {
  const name = key.split('.').at(-1)
  return plural === undefined ? `${name}` : `${name}:${named.count}/${plural}`
}

describe('snapshot options', () => {
  const site = { snapshotsEnabled: true, snapshotMaskText: false }

  it('names the changes the server discards snapshots on', () => {
    expect(changesSnapshotOptions(site, { snapshotsEnabled: false })).toBe(true)
    expect(changesSnapshotOptions(site, { snapshotMaskText: true })).toBe(true)
    // Unchanged values and absent keys discard nothing.
    expect(changesSnapshotOptions(site, { snapshotsEnabled: true })).toBe(false)
    expect(changesSnapshotOptions(site, { snapshotMaskText: false })).toBe(
      false,
    )
    expect(changesSnapshotOptions(site, {})).toBe(false)
    // A site saved before the mask existed has it off.
    expect(
      changesSnapshotOptions(
        { snapshotsEnabled: true },
        { snapshotMaskText: false },
      ),
    ).toBe(false)
  })

  it('asks with the count, or without it when it could not be read', () => {
    expect(snapshotDiscardConfirmation(t, 12)).toMatchObject({
      title: 'title',
      description: 'description:12/12',
      confirmLabel: 'confirm',
      cancelLabel: 'cancel',
      color: 'warning',
    })
    expect(snapshotDiscardConfirmation(t, null).description).toBe(
      'description_unknown',
    )
  })

  it('says in both languages that clicks and scroll depth are kept', () => {
    const en_ = en.page.marketing.websites.discard_confirm
    const fr_ = fr.page.marketing.websites.discard_confirm
    for (const text of [en_.description, en_.description_unknown]) {
      expect(text).toMatch(/Clicks and scroll depth are kept/)
    }
    for (const text of [fr_.description, fr_.description_unknown]) {
      expect(text).toMatch(
        /clics et la profondeur de défilement sont conservés/,
      )
    }
    // Singular | plural, the count in the plural.
    expect(en_.description.split(' | ')[1]).toContain('{count}')
    expect(fr_.description.split(' | ')[1]).toContain('{count}')
  })
})

describe('the heatmap menu snapshot checkboxes', () => {
  const site = { snapshotsEnabled: true, snapshotMaskText: false }

  /** The page's flow, as PagePreview wires it: ask, then save or not. */
  function menu(
    website: { snapshotsEnabled: boolean; snapshotMaskText: boolean },
    answer: boolean,
    count: number | null = 3,
  ) {
    const asked: string[] = []
    const saved: Array<Record<string, boolean>> = []
    const settled: Array<Promise<void>> = []
    const items = snapshotOptionItems(
      website,
      (patch) =>
        void settled.push(
          confirmSnapshotChange(website, patch, {
            count: async () => count,
            confirm: async (options) => {
              asked.push(options.title)
              return answer
            },
            t,
          }).then((go) => void (go && saved.push(patch))),
        ),
      t,
    )
    return { items, asked, saved, settled }
  }

  it('asks before "Mask all text" and saves nothing on Cancel', async () => {
    const { items, asked, saved, settled } = menu(site, false)
    const mask = items[1]!
    expect(mask.checked).toBe(false)
    mask.onUpdateChecked(true)
    await Promise.all(settled)
    expect(asked).toEqual(['title'])
    expect(saved).toEqual([])
    // Rebuilt from the website, which nothing changed: still unchecked.
    expect(snapshotOptionItems(site, () => {}, t)[1]!.checked).toBe(false)
  })

  it('asks even when the site holds no snapshot yet', async () => {
    const { items, asked, saved, settled } = menu(site, true, 0)
    items[1]!.onUpdateChecked(true)
    items[0]!.onUpdateChecked(false)
    await Promise.all(settled)
    expect(asked).toEqual(['title_none', 'title_none'])
    expect(saved).toEqual([
      { snapshotMaskText: true },
      { snapshotsEnabled: false },
    ])
  })

  it('turns snapshots on without asking when there are none', async () => {
    const off = { snapshotsEnabled: false, snapshotMaskText: false }
    const { items, asked, saved, settled } = menu(off, false, 0)
    expect(items[1]!.disabled).toBe(true)
    items[0]!.onUpdateChecked(true)
    await Promise.all(settled)
    expect(asked).toEqual([])
    expect(saved).toEqual([{ snapshotsEnabled: true }])
  })

  it('asks without a number when the count fails', async () => {
    let description = ''
    await confirmSnapshotChange(
      site,
      { snapshotMaskText: true },
      {
        count: () => Promise.reject(new Error('offline')),
        confirm: async (options) => {
          description = options.description
          return false
        },
        t,
      },
    )
    expect(description).toBe('description_unknown')
  })
})
