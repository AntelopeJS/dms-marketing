/**
 * Links between the module's surfaces.
 *
 * The `/modules/marketing` prefix comes from the pages being registered under
 * a DMS module. The website and the period are not in the links: the context
 * bar keeps both for the whole module.
 */

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

export function overviewLink(): string {
  return `${MODULE_BASE}/overview`
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
