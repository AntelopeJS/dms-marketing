/**
 * A host another website of the workspace already declares: the API answers
 * 409 `{ field, message: duplicate_host, values: [host, site] }`. The DMS
 * shows the message alone, so the forms name the site themselves.
 *
 * @packageDocumentation
 */
import type { Translate } from './translate'

const HTTP_CONFLICT = 409
const DUPLICATE_HOST = '$page.marketing.errors.duplicate_host'
/** The fields a host is declared in. */
const HOST_FIELDS = ['domain', 'extraDomains'] as const

export interface HostConflict {
  /** `domain` or `extraDomains`: the field that declares the host. */
  field: (typeof HOST_FIELDS)[number]
  host: string
  /** The name of the website that declares it. */
  site: string
}

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

function isHostField(field: string): field is HostConflict['field'] {
  return field === 'domain' || field === 'extraDomains'
}

/** What a failed request throws, as the DMS error helpers take it. */
type ApiError = Parameters<typeof apiErrorStatus>[0]

export function hostConflictOf(error: ApiError): HostConflict | null {
  if (apiErrorStatus(error) !== HTTP_CONFLICT) {
    return null
  }
  const [entry] = resolveFieldErrors(error, { fields: HOST_FIELDS }).fields
  const [host, site] = entry?.values ?? []
  if (entry?.message !== DUPLICATE_HOST || !host || !site) {
    return null
  }
  if (!isHostField(entry.field)) {
    return null
  }
  return { field: entry.field, host, site }
}
