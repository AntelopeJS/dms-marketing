import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// vitest runs with the frontend module as its root.
const SOURCE = readFileSync(
  join(process.cwd(), 'app', 'components', 'InstallGuide.vue'),
  'utf8',
)

/** The `:to` of the link whose label is the given i18n key. */
function linkTargetOf(labelKey: string): string | undefined {
  const link = new RegExp(
    String.raw`:to="([^"]+)"[^>]*>\s*\{\{\s*t\('${labelKey.replaceAll('.', String.raw`\.`)}'\)`,
  )
  return link.exec(SOURCE)?.[1]
}

describe('InstallGuide', () => {
  it("opens the added site's settings modal from step 1's Edit", () => {
    expect(linkTargetOf('page.marketing.common.edit')).toBe(
      'websitesLink(website.id)',
    )
  })
})
