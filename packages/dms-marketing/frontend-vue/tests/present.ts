/** `value`, or a failure of the test that expected it to be there. */
export function present<Value>(value: Value | null | undefined): Value {
  if (value === null || value === undefined) {
    throw new Error('Expected a value, found none')
  }
  return value
}
