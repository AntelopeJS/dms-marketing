/** An object a script published on `window` or a page handed in: the check before any field of it is read. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A string, as opposed to whatever page code passed in its place. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** A number that is neither `NaN` nor infinite. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
