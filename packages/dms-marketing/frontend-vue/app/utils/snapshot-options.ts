/**
 * Changing a site's snapshot options deletes its snapshots on the server
 * (`PUT /api/marketing/websites/:id`): off means forgotten, and a mask
 * setting only holds for captures taken under it. Every place offering the
 * options asks first, with the same words.
 */

/** The `t` of useI18n, as far as these helpers call it. */
type Translate = (
  key: string,
  named?: Record<string, unknown>,
  plural?: number,
) => string

interface SnapshotOptions {
  snapshotsEnabled: boolean
  snapshotMaskText?: boolean
}

/** Whether saving `patch` changes an option the server discards on. */
export function changesSnapshotOptions(
  website: SnapshotOptions,
  patch: Partial<SnapshotOptions>,
): boolean {
  return (
    (patch.snapshotsEnabled !== undefined &&
      patch.snapshotsEnabled !== website.snapshotsEnabled) ||
    (patch.snapshotMaskText !== undefined &&
      patch.snapshotMaskText !== (website.snapshotMaskText ?? false))
  )
}

/**
 * The confirmation asked before such a change; `count` is the site's
 * snapshots, null when it could not be read — the change still discards
 * whatever there is, so the question is asked without the number.
 */
export function snapshotDiscardConfirmation(
  t: Translate,
  count: number | null,
) {
  const prefix = 'page.marketing.websites.discard_confirm'
  return {
    title: t(`${prefix}.title`),
    description:
      count === null
        ? t(`${prefix}.description_unknown`)
        : t(`${prefix}.description`, { count }, count),
    confirmLabel: t(`${prefix}.confirm`),
    cancelLabel: t(`${prefix}.cancel`),
    color: 'warning' as const,
    icon: 'i-ph-warning',
  }
}
