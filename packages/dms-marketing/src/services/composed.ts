import type {
  BlockText,
  ComposedText,
} from "@antelopejs/interface-dms/base/types/composed-text";
import type { Tone } from "@antelopejs/interface-dms/base/types/tone";
import { SECONDS_PER_HOUR, SECONDS_PER_MINUTE } from "@/types/constants";

const COMPOSE_PREFIX = "$page.marketing.compose.";
const DECIMALS = 10;

/** No value to show: the cell keeps its dash. */
const NO_VALUE = "—";

/** Changes this small read as "no change", whatever their sign. */
const FLAT_DELTA = 0.05;

function oneDecimal(value: number): number {
  return Math.round(value * DECIMALS) / DECIMALS;
}

function compose(
  key: string,
  params: ComposedText["params"] = {},
): ComposedText {
  return { key: `${COMPOSE_PREFIX}${key}`, params };
}

/** "42.3%" — a value already in percent, not a ratio. */
export function percentText(value: number | null): BlockText {
  return value === null
    ? NO_VALUE
    : compose("percent", {
        value: { type: "number", value: oneDecimal(value) },
      });
}

/** "2m 48s", "1h 5m" or "12s": a visit length, the way analytics tools write it. */
export function durationText(seconds: number): ComposedText {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const rest = total % SECONDS_PER_MINUTE;
  if (hours > 0) {
    return compose("duration_hours", { hours, minutes });
  }
  return minutes > 0
    ? compose("duration_minutes", { minutes, seconds: rest })
    : compose("duration_seconds", { seconds: rest });
}

/** A number written for the locale with one decimal at most. */
export function decimalText(value: number | null): BlockText | number {
  return value === null ? NO_VALUE : oneDecimal(value);
}

/** How a change is written: in percentage points, as a duration, or a number. */
export type DeltaUnit = "points" | "seconds" | "number";

/**
 * "+2.1 pt · vs previous": a signed change against the comparison window, or
 * nothing when there is no comparison to read.
 */
export function deltaText(
  delta: number | null,
  unit: DeltaUnit,
): ComposedText | undefined {
  if (delta === null) {
    return undefined;
  }
  const rounded = unit === "seconds" ? Math.round(delta) : oneDecimal(delta);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  const magnitude = Math.abs(rounded);
  const value =
    unit === "seconds"
      ? durationText(magnitude)
      : compose(unit === "points" ? "points" : "number", {
          value: { type: "number", value: magnitude },
        });
  return compose("delta", { sign, value });
}

/** Good is up unless lower is better; a near-zero change is neutral. */
export function deltaTone(delta: number | null, invert = false): Tone {
  if (delta === null || Math.abs(delta) < FLAT_DELTA) {
    return "neutral";
  }
  const better = invert ? delta < 0 : delta > 0;
  return better ? "success" : "error";
}
