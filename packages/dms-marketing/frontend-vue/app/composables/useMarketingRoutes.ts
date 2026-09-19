/**
 * Links between the module's surfaces.
 *
 * The `/modules/marketing` prefix comes from the page being registered under
 * a DMS module, which also makes it platform-owner-only. Should the surfaces
 * ever move to a tenant-reachable category, this file is the only place that
 * has to know.
 */

const MODULE_BASE = '/modules/marketing'

interface PagesLink {
  website?: string | null
  path?: string | null
  period?: string | null
}

/** Query without the empty keys — a bare link must stay bare. */
function withQuery(base: string, query: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      params.set(key, value)
    }
  }
  const suffix = params.toString()
  return suffix ? `${base}?${suffix}` : base
}

/** The tracked-pages surface, optionally on a given site, path and window. */
export function pagesLink({ website, path, period }: PagesLink = {}) {
  return withQuery(`${MODULE_BASE}/pages`, { website, path, period })
}

interface CampaignsLink {
  website?: string | null
  period?: string | null
}

/** The acquisition surface, optionally on a given site and window. */
export function campaignsLink({ website, period }: CampaignsLink = {}) {
  return withQuery(`${MODULE_BASE}/campaigns`, { website, period })
}

interface FunnelsLink {
  website?: string | null
  funnel?: string | null
  period?: string | null
}

/** The funnels surface, optionally on a given site, funnel and window. */
export function funnelsLink({ website, funnel, period }: FunnelsLink = {}) {
  return withQuery(`${MODULE_BASE}/funnels`, { website, funnel, period })
}
