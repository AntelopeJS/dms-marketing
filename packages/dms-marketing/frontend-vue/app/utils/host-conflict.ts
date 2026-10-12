/**
 * A host another website of the workspace already declares: the API answers
 * 409 `{ field, message: duplicate_host, values: [host, site] }`. The DMS
 * shows the message alone, so the forms name the site themselves.
 */

const HTTP_CONFLICT = 409
const DUPLICATE_HOST = '$page.marketing.errors.duplicate_host'

export interface HostConflict {
  /** `domain` or `extraDomains`: the field that declares the host. */
  field: string
  host: string
  /** The name of the website that declares it. */
  site: string
}

interface FetchErrorLike {
  statusCode?: number
  status?: number
  data?: unknown
}

function bodyOf(error: FetchErrorLike): unknown {
  if (typeof error.data !== 'string') {
    return error.data
  }
  try {
    return JSON.parse(error.data) as unknown
  } catch {
    return undefined
  }
}

type Translate = (key: string, params?: Record<string, unknown>) => string

/**
 * The confirmation before "Allow this host": a refused host is only what a
 * beacon claimed, and anyone can send one naming any host.
 */
export function allowHostConfirmation(t: Translate, host: string) {
  const prefix = 'page.marketing.install.allow_confirm'
  return {
    title: t(`${prefix}.title`, { host }),
    description: t(`${prefix}.description`),
    confirmLabel: t(`${prefix}.confirm`),
    cancelLabel: t(`${prefix}.cancel`),
    color: 'warning' as const,
    icon: 'i-ph-warning',
  }
}

export function hostConflictOf(error: unknown): HostConflict | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }
  const failure = error as FetchErrorLike
  if ((failure.statusCode ?? failure.status) !== HTTP_CONFLICT) {
    return null
  }
  const body = bodyOf(failure) as
    | { field?: unknown; message?: unknown; values?: unknown }
    | undefined
  const [host, site] = Array.isArray(body?.values) ? body.values : []
  if (
    body?.message !== DUPLICATE_HOST ||
    typeof body.field !== 'string' ||
    typeof host !== 'string' ||
    typeof site !== 'string'
  ) {
    return null
  }
  return { field: body.field, host, site }
}
