/** Whether `value` is a string. */
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/** Whether `value` is a number, `NaN` included. */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

/** Whether `value` is a finite number: not `NaN`, not infinite. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Whether `value` is a plain object or class instance: not `null`, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether `value` is a DOM element. */
export function isElement(value: unknown): value is Element {
  return value instanceof Element
}
