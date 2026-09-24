import { z } from "zod";
import {
  MAX_COLLECT_BATCH_SIZE,
  MAX_EVENT_NAME_LENGTH,
  MAX_SCREEN_AND_LANGUAGE_CHARS,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  MAX_WEBSITE_ID_LENGTH,
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

const trackedEventSchema = z.object({
  kind: z.enum(EVENT_KINDS),
  /** Full location as seen by the tracker; the server stores the path only. */
  url: z.string().min(1).max(MAX_URL_LENGTH),
  referrer: z.string().max(MAX_URL_LENGTH).optional(),
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  screen: z.string().max(MAX_SCREEN_AND_LANGUAGE_CHARS).optional(),
  language: z.string().max(MAX_SCREEN_AND_LANGUAGE_CHARS).optional(),
  /** Custom event name, or experiment key for "exposure" events. */
  name: z.string().max(MAX_EVENT_NAME_LENGTH).optional(),
  data: z.record(z.unknown()).optional(),
  /** Client timestamp (ms); ignored when it drifts past the accepted skew. */
  at: z.number().int().positive().optional(),
});

export const collectRequestSchema = z.object({
  website: z.string().min(1).max(MAX_WEBSITE_ID_LENGTH),
  events: z.array(trackedEventSchema).min(1).max(MAX_COLLECT_BATCH_SIZE),
});

export type TrackedEventInput = z.infer<typeof trackedEventSchema>;

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
