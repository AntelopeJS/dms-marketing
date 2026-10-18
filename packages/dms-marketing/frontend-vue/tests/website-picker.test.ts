import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { barShowsWebsitePicker } from '../app/utils/website-picker'

// vitest runs with the frontend module as its root; the backend sits one level
// above it.
const PAGES_PAGE = join(process.cwd(), '..', 'src', 'pages', 'pages', 'page.ts')

describe('where the website picker sits', () => {
  it('leads the context bar by default', () => {
    expect(barShowsWebsitePicker(true, true)).toBe(true)
    expect(barShowsWebsitePicker(true, false)).toBe(true)
  })

  it('is left to a block when the page turns the bar one off', () => {
    expect(barShowsWebsitePicker(false, true)).toBe(false)
  })

  it('stays in the bar while it renders no block, so a switch stays possible', () => {
    // The waiting guide, the loading skeleton: no block carries it then.
    expect(barShowsWebsitePicker(false, false)).toBe(true)
  })

  it('is carried by the pages panel on Pages & heatmaps', () => {
    expect(readFileSync(PAGES_PAGE, 'utf8')).toMatch(/websitePicker:\s*false/)
  })
})
