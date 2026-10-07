/**
 * SVG path of a small line chart: `values` spread over `width`, scaled to
 * `height` with the highest value at the top. A flat or empty series draws a
 * line along the bottom rather than nothing.
 */
export function sparklinePath(
  values: number[],
  width: number,
  height: number,
): string {
  if (values.length === 0) {
    return `M0,${height} L${width},${height}`
  }
  const max = Math.max(...values, 0)
  const step = values.length > 1 ? width / (values.length - 1) : width
  return values
    .map((value, index) => {
      const x = index * step
      const y = max > 0 ? height - (value / max) * height : height
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}
