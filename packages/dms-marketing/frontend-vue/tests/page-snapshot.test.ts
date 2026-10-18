import { describe, expect, it } from 'vitest'
import { pageSnapshotBadge } from '../app/utils/page-snapshot'

/** A `t` that shows which key, values and plural form were asked for. */
function t(key: string, named: Record<string, unknown> = {}, plural?: number) {
  const name = key.split('.').at(-1)
  const values = Object.values(named).join(',')
  return plural === undefined
    ? `${name}(${values})`
    : `${name}:${plural}(${values})`
}

const NOW = Date.UTC(2026, 9, 17, 15)
const HOUR = 3_600_000

describe('the snapshot mark of a pages row', () => {
  it('says nothing while the site has snapshots off', () => {
    expect(pageSnapshotBadge(undefined, NOW, t, 'en-GB')).toBeNull()
  })

  it('says a page has none, muted', () => {
    expect(pageSnapshotBadge(null, NOW, t, 'en-GB')).toEqual({
      icon: 'i-ph-camera-slash',
      label: 'none()',
      title: 'none_title()',
      muted: true,
    })
  })

  it('gives the age of the newest capture and names its layouts', () => {
    const badge = pageSnapshotBadge(
      {
        capturedAt: NOW - 3 * HOUR,
        layouts: ['desktop', 'phone'],
        tooHeavy: false,
      },
      NOW,
      t,
      'fr-FR',
    )
    expect(badge).toEqual({
      icon: 'i-ph-camera',
      // Intl writes a no-break space before the unit.
      label: new Intl.RelativeTimeFormat('fr-FR', { style: 'short' }).format(
        -3,
        'hour',
      ),
      title: 'title:2(17 oct.,layout_desktop(), layout_phone())',
      muted: false,
    })
  })

  it('tells a page too heavy to capture', () => {
    const badge = pageSnapshotBadge(
      { capturedAt: NOW, layouts: [], tooHeavy: true },
      NOW,
      t,
      'en-GB',
    )
    expect(badge).toMatchObject({ icon: 'i-ph-file-x', label: 'too_heavy()' })
  })
})
