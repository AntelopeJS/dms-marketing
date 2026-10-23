import type { MarketingWorkspace } from '../composables/useMarketingApi'

/**
 * Whose dashboard the Pages & heatmaps view reads, for a platform owner on
 * the dashboard's own website: `''` their own workspace (the default, and the
 * only value anyone else ever has), `all` every workspace combined, or
 * another workspace's id. Deep-linked as `?workspace=`, remembered per
 * browser for the next visit.
 */
export const WORKSPACE_QUERY = 'workspace'
export const ALL_WORKSPACES = 'all'

const STORAGE_KEY = 'dms-marketing:heatmap-workspace'

/** The scope a link or the last visit asks for, applied only when the
 * selector offers it: anything else reads the viewer's own workspace. */
export function effectiveWorkspace(
  wanted: string | undefined,
  options: MarketingWorkspace[],
): string {
  if (!wanted || options.length < 2) {
    return ''
  }
  if (wanted === ALL_WORKSPACES) {
    return ALL_WORKSPACES
  }
  const option = options.find((workspace) => workspace.id === wanted)
  return option && !option.current ? option.id : ''
}

/** The last scope picked in this browser; `''` when none or unreadable. */
export function rememberedWorkspace(): string {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Kept for the next visit; the own workspace clears it. */
export function rememberWorkspace(workspace: string): void {
  try {
    if (workspace) {
      globalThis.localStorage?.setItem(STORAGE_KEY, workspace)
    } else {
      globalThis.localStorage?.removeItem(STORAGE_KEY)
    }
  } catch {
    // Storage blocked: the URL still carries the scope.
  }
}
