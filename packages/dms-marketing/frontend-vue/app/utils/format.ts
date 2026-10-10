/**
 * Locale formatting shared by the module's blocks. Pure functions of their
 * inputs, so the blocks stay thin and the rules stay testable.
 */

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const MS_PER_SECOND = 1000
const INITIALS_LENGTH = 2

export function formatNumber(
  value: number,
  locale: string,
  digits = 0,
): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

/** A share or rate already in percent units (41.2 → "41.2%"). */
export function formatPercent(
  value: number,
  locale: string,
  digits = 1,
): string {
  return `${formatNumber(value, locale, digits)}%`
}

/** "2m 48s", the way analytics tools write a visit length. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / SECONDS_PER_HOUR)
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const rest = total % SECONDS_PER_MINUTE
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`
}

/** Signed difference with its unit: "+8s", "−2.3 pt", "+0.1". */
export function formatSignedDelta(
  value: number,
  unit: 'points' | 'seconds' | 'number' | 'percent',
  locale: string,
): string {
  const rounded = Number(value.toFixed(unit === 'seconds' ? 0 : 1))
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '±'
  const magnitude = Math.abs(rounded)
  const formatters: Record<typeof unit, () => string> = {
    points: () => `${formatNumber(magnitude, locale, 1)} pt`,
    seconds: () => formatDuration(magnitude),
    number: () => formatNumber(magnitude, locale, 1),
    percent: () => formatPercent(magnitude, locale),
  }
  return `${sign}${formatters[unit]()}`
}

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', SECONDS_PER_MINUTE],
  ['minute', SECONDS_PER_MINUTE],
  ['hour', 24],
  ['day', 30],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
]

/** "12 seconds ago", "4 minutes ago" — the age of the last event. */
export function formatRelativeTime(
  at: number,
  now: number,
  locale: string,
): string {
  let value = Math.round((at - now) / MS_PER_SECOND)
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(value) < size) {
      return format.format(value, unit)
    }
    value = Math.round(value / size)
  }
  return format.format(value, 'year')
}

/** "Aug 31 – Sep 29, 2026", the resolved range of the period. */
export function formatDateRange(from: Date, to: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).formatRange(from, to)
}

export function formatShortDate(at: number | Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
  }).format(at)
}

/** "AS" for "Acme shop": the avatar of a website. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters =
    words.length > 1
      ? words.slice(0, INITIALS_LENGTH).map((word) => word[0])
      : [...(words[0] ?? '?')].slice(0, INITIALS_LENGTH)
  return letters.join('').toUpperCase()
}

/** Region and language names, falling back to the raw code on a bad one. */
export function displayName(
  code: string,
  type: 'region' | 'language',
  locale: string,
): string {
  try {
    return new Intl.DisplayNames([locale], { type }).of(code) ?? code
  } catch {
    return code
  }
}
