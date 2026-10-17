import { InterfaceFunction } from "@antelopejs/interface-core";

/**
 * Marketing content declared from code: websites and funnels a project ships
 * (a demo, a template, a migration), and history imported from elsewhere.
 *
 * Every call is keyed by an id the caller chooses and is safe to repeat on
 * each boot or hot reload. Calls made before the implementing module is ready
 * wait for it. They need the DMS database, which is ready once the DMS has
 * settled `Hook.DATABASE_INITIALIZED` from its own `start()`: await them from
 * a module's `start()` or later, never inside `construct()` — fire and forget
 * there, catching the rejection.
 * These are trusted backend calls, not tenant provisioning or authorization.
 * `start()` runs per process, not per tenant. SaaS callers supply an authorized
 * tenantId and ensure its storage exists through their own tenant lifecycle.
 */

/** How a declaration call left the stored record. */
export type MarketingDeclarationStatus =
  /** No record had this id: it was created from the declaration. */
  | "created"
  /** The record still matched the previous declaration and was refreshed. */
  | "updated"
  /** The record already matches the declaration: nothing was written. */
  | "unchanged"
  /**
   * Someone changed the record since it was last declared (or it was never
   * declared from code): its content is left as it is, declaration ignored.
   * Also returned when a concurrent change prevents the conditional write.
   * Observed divergence conditionally clears the hash so restoring old values
   * does not return ownership to code. Contention alone does not clear it.
   * Edits reverted before comparison are invisible. Conditional-write safety
   * requires an adapter retaining the predicate in the write (verified on MongoDB).
   */
  | "kept";

export interface MarketingDeclarationResult {
  /** The record's id: the declared one. */
  id: string;
  status: MarketingDeclarationStatus;
}

/** A website declared from code: what `data-website-id` names in the tag. */
export interface MarketingWebsiteDeclaration {
  /**
   * Stable id chosen by the caller, used as the website id itself (the
   * `data-website-id` of the tag): 1-64 letters, digits, `-` or `_`, starting
   * with a letter or a digit. Website ids are global across tenants: a
   * multi-tenant project puts the tenant in it.
   */
  id: string;
  /** Owning tenant; defaults to the DMS default tenant (`"default"`). */
  tenantId?: string;
  /** Display name, 1-100 characters. */
  name: string;
  /**
   * The site's hostname. A scheme, port or path is stripped
   * (`https://Shop.Example.com/x` → `shop.example.com`); beacons are only
   * accepted from this host, its subdomains and `extraDomains`.
   */
  domain: string;
  /** Other hosts the site serves from (at most 20), same rules. */
  extraDomains?: string[];
  /** False pauses collection for the site. Default true. */
  trackingEnabled?: boolean;
  /** Page snapshots for heatmap backdrops; they store page content. Default false. */
  snapshotsEnabled?: boolean;
  /** Mask every text node of the snapshots, not only form values. Default false. */
  snapshotMaskText?: boolean;
}

/** One funnel step: a page path (`url`) or a custom event name (`custom`). */
export interface MarketingFunnelStep {
  kind: "url" | "custom";
  value: string;
}

export type MarketingExperimentStatus = "draft" | "running" | "stopped";

/** One arm of an A/B split; weights are relative. The first is the control. */
export interface MarketingExperimentVariation {
  key: string;
  weight: number;
}

/** The A/B split of a declared funnel. */
export interface MarketingExperimentDeclaration {
  /** What page code passes to `dmsMarketing.variation(…)`; unique per website. */
  key: string;
  /** 2-8 arms with distinct keys, at least one weight above 0. */
  variations: MarketingExperimentVariation[];
  /**
   * Default `"draft"`. A declaration moves the split the way the dashboard
   * does (draft → running ⇄ stopped, never back to draft), and the arms
   * freeze once it has left draft.
   */
  status?: MarketingExperimentStatus;
  /**
   * When the run this declaration starts began (epoch ms or ISO 8601), not in
   * the future; defaults to now. Only read when the declaration starts a run
   * — results are counted from it, so a split declared with an imported
   * history passes the instant that history starts.
   */
  startedAt?: number | string;
  /** When the run this declaration stops ended; defaults to now. */
  stoppedAt?: number | string;
}

/** A conversion funnel declared from code, with an optional A/B split. */
export interface MarketingFunnelDeclaration {
  /** Stable id chosen by the caller, unique within the tenant; same shape as a website id. */
  id: string;
  /** Owning tenant; defaults to the DMS default tenant (`"default"`). */
  tenantId?: string;
  /** A website of the same tenant. */
  websiteId: string;
  /** Display name, 1-100 characters. */
  name: string;
  /** 1-10 steps; a page step is stored as a path (query and trailing slash dropped). */
  steps: MarketingFunnelStep[];
  /** Longest time from first to last step, 1-720 hours. Default 24. */
  conversionWindowHours?: number;
  /** Null or absent for a plain funnel. */
  experiment?: MarketingExperimentDeclaration | null;
}

/** The kinds of events an import replays, as the tracker sends them. */
export type MarketingImportEventKind =
  | "pageview"
  | "custom"
  | "exposure"
  | "click"
  | "scroll";

/**
 * One historical event. The fields and their limits are the tracker's: see
 * the tracker contract in the module's architecture docs.
 */
export interface MarketingImportEvent {
  kind: MarketingImportEventKind;
  /** When it happened: epoch ms or ISO 8601. */
  at: number | string;
  /** The page, absolute (`https://shop.example.com/pricing?utm_source=x`) or a path. */
  url: string;
  /** Where the visit came from; read on the visit's first pageview. */
  referrer?: string;
  title?: string;
  /** Custom event name, or the experiment key of an exposure. */
  name?: string;
  /**
   * Custom: any object up to 4 KiB. Exposure: `{ experiment, variation }`.
   * Click: `{ x, y, … }` (0-1). Scroll: `{ depth }` (0-100).
   */
  data?: Record<string, unknown>;
}

/** The events of one visitor, as one visit or several. */
export interface MarketingImportSession {
  /**
   * Opaque visitor key from the source (an analytics client id, a row
   * number): sessions sharing it are one returning visitor. It is hashed,
   * never stored, and imported visitors never merge with live ones.
   */
  visitor: string;
  /** Parsed into browser, OS and device type, then discarded, as live collection does. */
  userAgent?: string;
  /** ISO 3166-1 alpha-2 country code (`"BE"`): what live collection derives from the IP. */
  country?: string;
  /** `"1280x800"`, as the tracker reports it. */
  screen?: string;
  language?: string;
  events: MarketingImportEvent[];
}

/**
 * A server-side import of historical analytics into one website.
 * Send chronological windows for the whole website: eligible timestamps may
 * equal, but never precede, the previous completed import's latest timestamp.
 * Different import ids cannot write the same website concurrently. Retry a
 * busy refusal after completion; an interrupted replay requires reconciliation.
 */
export interface MarketingAnalyticsImport {
  /**
   * Stable id of this import, chosen by the caller: an import id is applied
   * once per website, and every later call with it is skipped whatever its
   * payload. History cannot be imported twice or replaced.
   */
  importId: string;
  /** Owning tenant of the website; defaults to the DMS default tenant. */
  tenantId?: string;
  websiteId: string;
  sessions: MarketingImportSession[];
}

export interface MarketingImportResult {
  importId: string;
  /** `"skipped"`: the import id was already applied (or is being applied). */
  status: "imported" | "skipped";
  /** Visits the replay opened, which can differ from the sessions sent. */
  sessions: number;
  /** Events written. */
  events: number;
  /**
   * Events refused: invalid, in the future, older than the statistics
   * retention, an interaction without a session, or an exposure of an
   * experiment that never left draft.
   */
  dropped: number;
}

/**
 * Creates or refreshes a website from its declaration. Idempotent: a record
 * still identical to what was last declared is refreshed to the new
 * declaration; one a user changed since (or never declared from code) is
 * kept as is (`"kept"`). Rejects on invalid input, on an id taken by another
 * tenant, and on a host another website of the tenant already declares.
 */
export const EnsureWebsite =
  InterfaceFunction<
    (
      declaration: MarketingWebsiteDeclaration,
    ) => Promise<MarketingDeclarationResult>
  >();

/**
 * Creates or refreshes a funnel, and its A/B split, from its declaration.
 * Same idempotency rule as {@link EnsureWebsite}. Rejects on invalid input, an
 * unknown website, an experiment key another funnel of the website uses, a
 * status move the lifecycle refuses, or a change to the arms of a split that
 * left draft.
 */
export const EnsureFunnel =
  InterfaceFunction<
    (
      declaration: MarketingFunnelDeclaration,
    ) => Promise<MarketingDeclarationResult>
  >();

/**
 * Replays historical sessions and events through the live collection
 * pipeline with their own timestamps — sessions, raw events and the daily
 * statistics come out as if the tracker had sent them then. Distinct from the
 * declarations: it adds data, once per import id, and nothing can undo it
 * but deleting the website.
 */
export const ImportAnalytics =
  InterfaceFunction<
    (batch: MarketingAnalyticsImport) => Promise<MarketingImportResult>
  >();
