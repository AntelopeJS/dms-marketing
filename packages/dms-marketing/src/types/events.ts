import { z } from "zod";
import {
  MAX_CLICK_SELECTOR_LENGTH,
  MAX_COLLECT_BATCH_SIZE,
  MAX_EVENT_DATA_BYTES,
  MAX_EVENT_NAME_LENGTH,
  MAX_EXPERIMENT_KEY_LENGTH,
  MAX_SCREEN_AND_LANGUAGE_CHARS,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  MAX_WEBSITE_ID_LENGTH,
  SCROLL_DEPTH_SCALE,
} from "./constants";

/**
 * Wire contract of the public collect endpoint. The shape follows the Umami
 * tracker payload (url/referrer/title/screen/language + name/data), but
 * events are batched: heatmap capture emits far more events than pageviews.
 * The payload never carries a visitor id — identity is derived per request
 * from a monthly salt (services/visitor-id), which keeps collection eligible
 * for the audience-measurement consent exemptions.
 */

const EVENT_KINDS = [
  "pageview",
  "custom",
  "exposure",
  "click",
  "scroll",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

/** Kinds the heatmap surface reads — sampled together, reset together. */
export const HEATMAP_EVENT_KINDS: EventKind[] = ["click", "scroll"];

/**
 * Free text that only gives context (title, referrer, screen, language) is
 * cut to its cap, never refused: an over-long page title must not cost the
 * pageview it describes.
 */
const clipped = (max: number) =>
  z.string().transform((value) => value.slice(0, max));

/** A field this kind does not carry: ignored rather than refused. */
const ignored = z.unknown().transform((): undefined => undefined);

/** Absolute http(s) or site-relative: `javascript:`, `data:` and friends
 * name no page of the site. */
const TRACKED_URL_PATTERN = /^(https?:\/\/|\/)/i;

/** 0-1 coordinate; NaN and infinities fail the bounds. */
const fraction = z.number().min(0).max(1);

const customDataSchema = z
  .record(z.unknown())
  .refine((data) => JSON.stringify(data).length <= MAX_EVENT_DATA_BYTES);

const eventBaseSchema = z.object({
  /** Full location as seen by the tracker; the server stores the path only. */
  url: z
    .string()
    .min(1)
    .regex(TRACKED_URL_PATTERN)
    .transform((value) => value.slice(0, MAX_URL_LENGTH)),
  referrer: clipped(MAX_URL_LENGTH).optional(),
  title: clipped(MAX_TITLE_LENGTH).optional(),
  screen: clipped(MAX_SCREEN_AND_LANGUAGE_CHARS).optional(),
  language: clipped(MAX_SCREEN_AND_LANGUAGE_CHARS).optional(),
  /** Client timestamp (ms); ignored when it drifts past the accepted skew. */
  at: z.number().int().positive().optional(),
});

/**
 * One event, validated on its own: collect parses the batch envelope first,
 * then each event, and drops (counts) the ones that fail — one bad field
 * never costs the pageview it was batched with. `data` is checked per kind,
 * since heatmaps and experiment reports read it back as numbers and keys.
 */
export const trackedEventSchema = z.discriminatedUnion("kind", [
  eventBaseSchema.extend({
    kind: z.literal("pageview"),
    name: ignored,
    /** The heatmap sampling rate the tracker applied to this view; anything
     * else is dropped, the pageview kept. */
    data: z.object({ sample: fraction }).optional().catch(undefined),
  }),
  eventBaseSchema.extend({
    kind: z.literal("custom"),
    name: z.string().min(1).max(MAX_EVENT_NAME_LENGTH),
    data: customDataSchema.optional(),
  }),
  eventBaseSchema.extend({
    kind: z.literal("exposure"),
    /** The experiment key: as long as the funnel builder lets it be. */
    name: z.string().min(1).max(MAX_EXPERIMENT_KEY_LENGTH),
    data: z.object({
      experiment: z.string().min(1).max(MAX_EXPERIMENT_KEY_LENGTH),
      variation: z.string().min(1).max(MAX_EXPERIMENT_KEY_LENGTH),
    }),
  }),
  eventBaseSchema.extend({
    kind: z.literal("click"),
    name: ignored,
    data: z.object({
      x: fraction,
      y: fraction,
      dx: fraction.optional(),
      dy: fraction.optional(),
      selector: z.string().max(MAX_CLICK_SELECTOR_LENGTH).optional(),
      ox: fraction.optional(),
      oy: fraction.optional(),
      nth: z.number().int().nonnegative().optional(),
    }),
  }),
  eventBaseSchema.extend({
    kind: z.literal("scroll"),
    name: ignored,
    data: z.object({
      depth: z.number().int().min(0).max(SCROLL_DEPTH_SCALE),
    }),
  }),
]);

/** The envelope alone: events are validated one by one afterwards. */
export const collectRequestSchema = z.object({
  website: z.string().min(1).max(MAX_WEBSITE_ID_LENGTH),
  events: z.array(z.unknown()).min(1).max(MAX_COLLECT_BATCH_SIZE),
});

export type TrackedEventInput = z.output<typeof trackedEventSchema>;

/**
 * `data` payload of a "click" event. `x`/`y` are viewport-normalized (0-1):
 * where on the screen people click. `dx`/`dy` are document-normalized
 * (pageX / document width, pageY / document height). `selector` is the
 * nearest short CSS selector of the element hit.
 *
 * `ox`/`oy`/`nth` are the element anchor and are what a heatmap projects
 * from: the offset inside the clicked element's box, plus its index among
 * the selector's matches. Document fractions are the fallback, not the
 * reference — they divide by a document box that on a page shorter than the
 * visitor's window is the window itself, so the same element yields a
 * different `dy` per window size. The anchor is absent on clicks whose target
 * was the document.
 */
export interface ClickEventData {
  x: number;
  y: number;
  dx?: number;
  dy?: number;
  selector?: string;
  ox?: number;
  oy?: number;
  nth?: number;
}

/** `data` payload of a "scroll" event: max depth reached on the page, 0-100. */
export interface ScrollEventData {
  depth: number;
}

/** `data` payload of an "exposure" event: assigned experiment variation. */
export interface ExposureEventData {
  experiment: string;
  variation: string;
}
