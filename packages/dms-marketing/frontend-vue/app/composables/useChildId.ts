import { toValue, type MaybeRefOrGetter } from 'vue'

/**
 * Derives one stable id per child from the id the DMS page renderer hands the
 * component. dms-ui primitives key their events and their persisted state on
 * it, so two children sharing an id share that state; the `${parent}-child`
 * shape is the one DmsRecursiveComponent uses.
 */
export function useChildId(
  componentId: MaybeRefOrGetter<string | undefined>,
): (suffix: string) => string {
  return (suffix: string) => `${toValue(componentId)}-${suffix}`
}
