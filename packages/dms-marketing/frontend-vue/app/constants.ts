/**
 * Module-wide constants, imported explicitly.
 *
 * Deliberately outside `app/composables`, `app/types` and `app/utils`: the DMS
 * frontend builder auto-imports everything those directories export into the
 * shared namespace, where a generic name silently shadows the core's. This
 * file is never scanned, so anything here has to be imported by hand.
 */

export const MS_PER_DAY = 86_400_000
