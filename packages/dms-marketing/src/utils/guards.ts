/** Whether `value` is a string. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Whether `value` is a number, `NaN` and the infinities included. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** Whether `value` is a non-null object, arrays included. */
export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** Whether `value` is a boolean. */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}
