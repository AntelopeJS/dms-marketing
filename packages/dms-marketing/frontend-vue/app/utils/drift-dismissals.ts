import { ref } from 'vue'

/**
 * Pages whose drift warning was dismissed: for the rest of the session (the
 * tab's lifetime), per website and path, so switching pages and coming back
 * does not bring it back. A reload does: the drift is still there.
 */
const dismissed = ref(new Set<string>())

function key(websiteId: string, path: string): string {
  return `${websiteId}\u0000${path}`
}

export function driftDismissed(websiteId: string, path: string): boolean {
  return dismissed.value.has(key(websiteId, path))
}

export function dismissDrift(websiteId: string, path: string): void {
  dismissed.value = new Set(dismissed.value).add(key(websiteId, path))
}
