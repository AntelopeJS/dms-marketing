import { afterEach, describe, expect, it } from 'vitest'
import {
  applyDashboardTracker,
  DASHBOARD_TRACKER_ELEMENT_ID,
} from '../app/utils/dashboard-tracker'
import { present } from './present'

const SRC = 'https://dms.example.com/api/marketing/tracker.js'
const EXCLUDED = ['/auth/**', '/settings/*']

afterEach(() => {
  document.head.innerHTML = ''
})

const scripts = () => document.head.querySelectorAll('script')

describe('the dashboard tag', () => {
  it('is not inserted before there is a website to report to', () => {
    applyDashboardTracker(document, {
      src: SRC,
      websiteId: null,
      excludePaths: EXCLUDED,
    })
    expect(scripts()).toHaveLength(0)
  })

  it('is inserted once, then paused and retargeted in place', () => {
    applyDashboardTracker(document, {
      src: SRC,
      websiteId: 'site-a',
      excludePaths: EXCLUDED,
    })
    expect(scripts()).toHaveLength(1)
    const tag = present(document.head.querySelector('script'))
    expect(tag.id).toBe(DASHBOARD_TRACKER_ELEMENT_ID)
    expect(tag.src).toBe(SRC)
    expect(tag.async).toBe(true)
    expect(tag.getAttribute('data-website-id')).toBe('site-a')
    expect(tag.getAttribute('data-exclude-paths')).toBe('/auth/**,/settings/*')

    applyDashboardTracker(document, {
      src: SRC,
      websiteId: null,
      excludePaths: EXCLUDED,
    })
    expect(tag.hasAttribute('data-website-id')).toBe(false)

    applyDashboardTracker(document, {
      src: SRC,
      websiteId: 'site-b',
      excludePaths: EXCLUDED,
    })
    expect(scripts()).toHaveLength(1)
    expect(tag.getAttribute('data-website-id')).toBe('site-b')
  })
})
