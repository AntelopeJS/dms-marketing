import { ValueProxy } from "@antelopejs/interface-database";
import {
  HEATMAP_DIVISIONS_PER_AXIS,
  MAX_CLICK_SELECTOR_LENGTH,
} from "@/types/constants";
import { z } from "zod";

/**
 * A click `data` as stored: every field is checked before it is read.
 * `x`/`y` are viewport-normalized (0-1): where on the screen people click.
 * `dx`/`dy` are document-normalized (pageX / document width, pageY / document
 * height). `selector` is the nearest short CSS selector of the element hit.
 *
 * `ox`/`oy`/`nth` are the element anchor and are what a heatmap projects
 * from: the offset inside the clicked element's box, plus its index among
 * the selector's matches. Document fractions are the fallback, not the
 * reference: they divide by a document box that on a page shorter than the
 * visitor's window is the window itself, so the same element yields a
 * different `dy` per window size. The tracker sends no anchor on clicks whose
 * target was the document.
 */
export interface StoredClickData {
  x: number;
  y: number;
  dx: number;
  dy: number;
  selector: string;
  ox: number;
  oy: number;
  nth: number;
}

/** `$min` over `{ at, x, y }` objects compares `at` first and returns the
 * earliest click whole, but `Stream.min` is typed as a number: the object is
 * parsed back. */
export const firstClickSchema = z.object({
  at: z.number(),
  x: z.number(),
  y: z.number(),
});

/**
 * Number in [0, 1]. BSON orders null and missing below numbers and strings,
 * objects, arrays and booleans above them, so the range admits exactly the
 * finite numbers in it: the type guard and the bound are one predicate.
 */
function isFraction(value: ValueProxy<number>): ValueProxy<boolean> {
  return value.ge(0).and(value.le(1));
}

/** Number in [0, Number.MAX_VALUE], by the ordering {@link isFraction} reads. */
function isNonNegative(value: ValueProxy<number>): ValueProxy<boolean> {
  return value.ge(0).and(value.le(Number.MAX_VALUE));
}

/** Strings sort between numbers and objects, and `{}` is the least object. */
function isString(value: ValueProxy<string>): ValueProxy<boolean> {
  return value.ge("").and(value.lt(ValueProxy.constant({}).cast<string>()));
}

/** An absent field sorts below null; a stored null does not. */
function isMissing(value: ValueProxy<number | string>): ValueProxy<boolean> {
  return value.lt(ValueProxy.constant(null).cast<number | string>());
}

/** A field the click may omit, and must otherwise pass `check`. */
function isOptional<T extends number | string>(
  value: ValueProxy<T>,
  check: (value: ValueProxy<T>) => ValueProxy<boolean>,
): ValueProxy<boolean> {
  return isMissing(value.cast<number | string>()).or(check(value));
}

/**
 * The types and bounds `clickDataSchema` sets, from comparisons alone: the
 * planner evaluates a filter on every row, whatever `$and` already rejected,
 * so a filter that throws on one row aborts the read.
 */
export function hasClickTypes(
  data: ValueProxy<StoredClickData>,
): ValueProxy<boolean> {
  return isFraction(data.key("x"))
    .and(isFraction(data.key("y")))
    .and(isOptional(data.key("dx"), isFraction))
    .and(isOptional(data.key("dy"), isFraction))
    .and(isOptional(data.key("ox"), isFraction))
    .and(isOptional(data.key("oy"), isFraction))
    .and(isOptional(data.key("nth"), isNonNegative))
    .and(isOptional(data.key("selector"), isString));
}

/**
 * The rest of `clickDataSchema`, which needs `$strLenCP` and `$floor`: both
 * throw on a value of another type, so they run in a projection, on the rows
 * {@link hasClickTypes} let through.
 */
export function hasClickBounds(
  data: ValueProxy<StoredClickData>,
): ValueProxy<boolean> {
  const nth = data.key("nth").default(0);
  return data
    .key("selector")
    .default("")
    .strlen()
    .le(MAX_CLICK_SELECTOR_LENGTH)
    .and(nth.floor().eq(nth));
}

/** A click that names its element and its offset in it; a click with an
 * empty selector, or without an offset, falls to the document grid. */
export function isAnchored(
  data: ValueProxy<StoredClickData>,
): ValueProxy<boolean> {
  return data
    .key("selector")
    .gt("")
    .and(data.key("ox").ge(0))
    .and(data.key("oy").ge(0));
}

/** Normalized coordinate → grid index, rounding half up as `Math.round`
 * does: `$round` rounds half to even. */
export function gridIndex(normalized: ValueProxy<number>): ValueProxy<number> {
  return normalized.mul(HEATMAP_DIVISIONS_PER_AXIS).add(0.5).floor();
}

/** The click's document point: page coordinates win over viewport ones. */
export function documentPoint(data: ValueProxy<StoredClickData>) {
  return {
    x: data.key("dx", data.key("x")),
    y: data.key("dy", data.key("y")),
  };
}
