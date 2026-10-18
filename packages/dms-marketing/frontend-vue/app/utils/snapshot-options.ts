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

type SnapshotPatch = Partial<SnapshotOptions>

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
 * Whether saving `patch` asks first: any change of those options, holding
 * snapshots or not — a site with none yet still changes what every later
 * capture keeps, and the question must come wherever the option is
 * toggled. Turning snapshots on for a site holding none is the exception:
 * there is nothing to lose and nothing to warn about. `count` is the
 * site's snapshots, null when it could not be read.
 */
export function asksBeforeSnapshotChange(
  website: SnapshotOptions,
  patch: Partial<SnapshotOptions>,
  count: number | null,
): boolean {
  if (!changesSnapshotOptions(website, patch)) {
    return false
  }
  const enabling = patch.snapshotsEnabled === true && !website.snapshotsEnabled
  return !(enabling && count === 0)
}

/** What confirming a snapshot option change needs from its page. */
export interface SnapshotChangeSteps {
  /** The site's snapshots; null when they could not be counted. */
  count: () => Promise<number | null>
  /** Resolves true when the person goes ahead. */
  confirm: (
    options: ReturnType<typeof snapshotDiscardConfirmation>,
  ) => Promise<boolean>
  t: Translate
}

/**
 * Whether `patch` may be saved: counted, then asked when
 * asksBeforeSnapshotChange says so. Nothing is saved on a refusal, so a
 * control bound to the website keeps showing what the website holds.
 */
export async function confirmSnapshotChange(
  website: SnapshotOptions,
  patch: SnapshotPatch,
  steps: SnapshotChangeSteps,
): Promise<boolean> {
  if (!changesSnapshotOptions(website, patch)) {
    return true
  }
  const count = await steps.count().catch(() => null)
  if (!asksBeforeSnapshotChange(website, patch, count)) {
    return true
  }
  return steps.confirm(snapshotDiscardConfirmation(steps.t, count))
}

/**
 * The two option checkboxes of the heatmap preview's menu. Bound to the
 * website, never to a local copy: a declined change leaves them as they
 * were, and a saved one shows once the website comes back updated.
 */
export function snapshotOptionItems(
  website: SnapshotOptions | null,
  change: (patch: SnapshotPatch) => void,
  t: Translate,
) {
  const enabled = website?.snapshotsEnabled ?? false
  return [
    {
      type: 'checkbox' as const,
      label: t('page.marketing.pages.preview.snapshots_enabled'),
      checked: enabled,
      onUpdateChecked: (value: boolean): void =>
        change({ snapshotsEnabled: value }),
    },
    {
      type: 'checkbox' as const,
      label: t('page.marketing.pages.preview.mask_text'),
      checked: website?.snapshotMaskText === true,
      disabled: !enabled,
      onUpdateChecked: (value: boolean): void =>
        change({ snapshotMaskText: value }),
    },
  ]
}

/**
 * The confirmation asked before such a change; `count` is the site's
 * snapshots, null when it could not be read — the change still discards
 * whatever there is, so the question is asked without the number — and 0
 * when there are none to discard, the question then being the setting.
 */
export function snapshotDiscardConfirmation(
  t: Translate,
  count: number | null,
) {
  const prefix = 'page.marketing.websites.discard_confirm'
  if (count === 0) {
    return {
      title: t(`${prefix}.title_none`),
      description: t(`${prefix}.description_none`),
      confirmLabel: t(`${prefix}.confirm_none`),
      cancelLabel: t(`${prefix}.cancel_none`),
      color: 'warning' as const,
      icon: 'i-ph-camera',
    }
  }
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
