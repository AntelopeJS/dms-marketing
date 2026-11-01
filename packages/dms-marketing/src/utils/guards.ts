import type { JsonObject, JsonValue } from "@/types/json";

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

/** A step of the walk in {@link isJsonValue}: visit a node, or leave one. */
type JsonWalkStep = { visit: unknown } | { leave: object };

/**
 * Whether `value` is wholly JSON data: strings, numbers, booleans, null, and
 * arrays and plain objects of the same, none of them reached through itself.
 * Walked with a stack, so a deeply nested body cannot overflow it.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  const stack: JsonWalkStep[] = [{ visit: value }];
  const ancestors = new Set<object>();
  for (let step = stack.pop(); step; step = stack.pop()) {
    if ("leave" in step) {
      ancestors.delete(step.leave);
      continue;
    }
    const item = step.visit;
    if (item === null || isString(item) || isNumber(item) || isBoolean(item)) {
      continue;
    }
    if (!isObject(item) || ancestors.has(item)) {
      return false;
    }
    const prototype: unknown = Object.getPrototypeOf(item);
    if (
      !Array.isArray(item) &&
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      return false;
    }
    ancestors.add(item);
    stack.push({ leave: item });
    for (const child of Object.values(item)) {
      stack.push({ visit: child });
    }
  }
  return true;
}

/** Whether `value` is a JSON object (see {@link isJsonValue}). */
export function isJsonObject(value: unknown): value is JsonObject {
  return isObject(value) && !Array.isArray(value) && isJsonValue(value);
}
