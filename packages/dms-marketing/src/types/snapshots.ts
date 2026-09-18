import { z } from "zod";
import {
  MAX_REPORTED_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_DOCUMENT_PX,
  MAX_SNAPSHOT_VIEWPORT_PX,
  MAX_URL_LENGTH,
  MAX_WEBSITE_ID_LENGTH,
} from "./constants";

/**
 * Layouts a page is captured for, widest first. The console renders them at
 * 1280, 768 and 390 px; a visitor's viewport is bucketed by `layoutOfWidth`.
 */
export const SNAPSHOT_LAYOUTS = ["desktop", "tablet", "phone"] as const;

export type SnapshotLayout = (typeof SNAPSHOT_LAYOUTS)[number];

const LAYOUT_MIN_WIDTHS: Record<SnapshotLayout, number> = {
  desktop: 1024,
  tablet: 600,
  phone: 0,
};

export function layoutOfWidth(width: number): SnapshotLayout {
  return (
    SNAPSHOT_LAYOUTS.find((layout) => width >= LAYOUT_MIN_WIDTHS[layout]) ??
    "phone"
  );
}

export function isSnapshotLayout(value: unknown): value is SnapshotLayout {
  return SNAPSHOT_LAYOUTS.includes(value as SnapshotLayout);
}

export const SNAPSHOT_COLOR_SCHEMES = ["light", "dark"] as const;

export type SnapshotColorScheme = (typeof SNAPSHOT_COLOR_SCHEMES)[number];

const dimensionSchema = (max: number) =>
  z.object({
    width: z.number().int().min(1).max(max),
    height: z.number().int().min(1).max(max),
  });

const snapshotPageSchema = z.object({
  website: z.string().min(1).max(MAX_WEBSITE_ID_LENGTH),
  /** Full location as the tracker sees it; the server keeps path and origin. */
  url: z.string().min(1).max(MAX_URL_LENGTH),
  viewport: dimensionSchema(MAX_SNAPSHOT_VIEWPORT_PX),
  colorScheme: z.enum(SNAPSHOT_COLOR_SCHEMES).optional(),
});

/** Wire contract of the public snapshot upload (static/snapshot.js). */
export const snapshotRequestSchema = z.union([
  snapshotPageSchema.extend({
    document: dimensionSchema(MAX_SNAPSHOT_DOCUMENT_PX),
    html: z.string().min(1).max(MAX_SNAPSHOT_BYTES),
  }),
  snapshotPageSchema.extend({
    oversizeBytes: z.number().int().positive().max(MAX_REPORTED_SNAPSHOT_BYTES),
  }),
]);

export type SnapshotRequestInput = z.infer<typeof snapshotRequestSchema>;
