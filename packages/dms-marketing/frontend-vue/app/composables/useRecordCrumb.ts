import { watch } from 'vue'
import { useDmsRoute } from '#dms/frontend-module'

/**
 * Ends the page's breadcrumb with the name of the record it shows ("… ›
 * Marketing › Checkout funnel") through the DMS's `usePageRecordLabel`, which
 * a form's `labelKey` uses on stock record pages. A page drawing its own
 * record (a custom block) names it the same way; while the record is loading
 * or missing, the page's own name stays.
 */
export function useRecordCrumb(name: () => string | null | undefined): void {
  const route = useDmsRoute()
  const { setLabel } = usePageRecordLabel()
  watch(name, (label) => setLabel(route.path, label || undefined), {
    immediate: true,
  })
}
