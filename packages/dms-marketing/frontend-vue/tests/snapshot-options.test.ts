import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/marketing-en-GB.json'
import fr from '../i18n/locales/marketing-fr-FR.json'
import {
  changesSnapshotOptions,
  snapshotDiscardConfirmation,
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
