/**
 * Links between the module's surfaces.
 *
 * The `/modules/marketing` prefix comes from the pages being registered under
 * a DMS module. The context bar reads the website and the period from the
 * page URL, the reader's saved ones standing in for what it leaves out: a
 * link followed from an analytics page carries the page's own, or it would
 * open on whatever another tab saved last: {@link withWebsite} for the
 * website, the DMS `withPeriodQuery` for the period selector's keys.
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

/** A setting of the Websites page's settings modal a link can open on. */
export type WebsiteSetting = 'snapshots'

const WEBSITES_PATH = `${MODULE_BASE}/websites`

/**
 * The Websites page; with `record`, the settings modal of that site open
 * (the table's deep link), scrolled to `setting` when given — where a
 * setting shown elsewhere (the heatmap preview's snapshot state) links to.
 */
export function websitesLink(
  record?: string | null,
  setting?: WebsiteSetting,
): string {
  return withQuery(WEBSITES_PATH, {
    record,
    setting: record ? setting : null,
  })
}

/** The setting a Websites page URL scrolls the open modal to, if any. */
export function websiteSettingOf(
  query: Record<string, unknown>,
): WebsiteSetting | undefined {
  return query.setting === 'snapshots' ? 'snapshots' : undefined
}

interface RouteLike {
  path: string
  query: Record<string, unknown>
}

/**
 * The settings used to open in a drawer named by `?edit=<id>`; the modal
 * that replaced it is the table's `?record=<id>`. An old link (a bookmark,
 * a project's own) lands on its new form, `setting` kept; null for every
 * other URL.
 */
export function legacyWebsiteEditLink(route: RouteLike): string | null {
  const { edit, setting, ...rest } = route.query
  if (route.path !== WEBSITES_PATH || typeof edit !== 'string' || !edit) {
    return null
  }
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(rest)) {
    if (typeof value === 'string') {
      params.set(key, value)
    }
  }
  params.set('record', edit)
  const kept = websiteSettingOf({ setting })
  if (kept) {
    params.set('setting', kept)
  }
  return `${WEBSITES_PATH}?${params.toString()}`
}

/** The install guide: a new website, or the one `website` names. */
export function installLink(website?: string | null): string {
  return withQuery(`${MODULE_BASE}/install`, { website })
}

export function settingsLink(): string {
  return `${MODULE_BASE}/settings`
}

/**
 * `link` on the website of the page it is followed from (`query`, that page's
 * route query), unless the link names one itself. `useContextLink` adds the
 * period through the DMS `withPeriodQuery`.
 */
export function withWebsite(
  link: string,
  query: Record<string, unknown>,
): string {
  const website = query.website
  if (typeof website !== 'string' || !website) {
    return link
  }
  const [path, search = ''] = link.split('?')
  const params = new URLSearchParams(search)
  if (params.has('website')) {
    return link
  }
  params.set('website', website)
  return `${path}?${params.toString()}`
}
