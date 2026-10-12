/**
 * Links between the module's surfaces.
 *
 * The `/modules/marketing` prefix comes from the pages being registered under
 * a DMS module. The context bar reads the website and the period from the
 * page URL, the reader's saved ones standing in for what it leaves out: a
 * link followed from an analytics page carries the page's own through
 * {@link linkInContext}, or it would open on whatever another tab saved last.
 */

import { PERIOD_SCOPE } from '../constants'

const MODULE_BASE = '/modules/marketing'

/** Query without the empty keys — a bare link must stay bare. */
function withQuery(
  base: string,
  query: Record<string, string | null | undefined>,
): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      params.set(key, value)
    }
  }
  const suffix = params.toString()
  return suffix ? `${base}?${suffix}` : base
}

/** The overview, on `website` when given. */
export function overviewLink(website?: string | null): string {
  return withQuery(`${MODULE_BASE}/overview`, { website })
}

/** Pages & heatmaps, optionally on a given path. */
export function pagesLink(path?: string | null): string {
  return withQuery(`${MODULE_BASE}/pages`, { path })
}

export function acquisitionLink(): string {
  return `${MODULE_BASE}/acquisition`
}

export function funnelsLink(): string {
  return `${MODULE_BASE}/funnels`
}

/** One funnel's report (an A/B test's when it carries one). */
export function funnelLink(id: string): string {
  return withQuery(`${MODULE_BASE}/funnel`, { id })
}

interface BuilderOptions {
  /** Open with the A/B section switched on. */
  split?: boolean
  /** Prefill the steps of a new funnel (a template). */
  steps?: { kind: 'url' | 'custom'; value: string }[]
  /** Start a new funnel as a copy of this one (Duplicate). */
  copy?: string
}

/** The builder: a new funnel, or the one `id` names. */
export function funnelBuilderLink(
  id?: string | null,
  options: BuilderOptions = {},
): string {
  return withQuery(`${MODULE_BASE}/funnel-builder`, {
    id,
    split: options.split ? '1' : null,
    steps: options.steps ? JSON.stringify(options.steps) : null,
    copy: options.copy,
  })
}

export function websitesLink(): string {
  return `${MODULE_BASE}/websites`
}

/** The install guide: a new website, or the one `website` names. */
export function installLink(website?: string | null): string {
  return withQuery(`${MODULE_BASE}/install`, { website })
}

export function settingsLink(): string {
  return `${MODULE_BASE}/settings`
}

/**
 * What an analytics page keeps in its URL: the context bar's website and its
 * period selector's keys (see the DMS `periodQueryKeys`).
 */
const CONTEXT_KEYS = [
  'website',
  ...['period', 'compare', 'from', 'to', 'compareFrom', 'compareTo'].map(
    (key) => `${PERIOD_SCOPE}.${key}`,
  ),
]

/**
 * `link` with the website and the period of the page it is followed from
 * (`query`, that page's route query); what the link names itself wins.
 */
export function linkInContext(
  link: string,
  query: Record<string, unknown>,
): string {
  const [path, search = ''] = link.split('?')
  const params = new URLSearchParams(search)
  for (const key of CONTEXT_KEYS) {
    const value = query[key]
    if (typeof value === 'string' && value && !params.has(key)) {
      params.set(key, value)
    }
  }
  const suffix = params.toString()
  return suffix ? `${path}?${suffix}` : path!
}
