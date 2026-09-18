// =============================================================================
// Module
// =============================================================================

export const MARKETING_MODULE_ID = "marketing";
export const OVERVIEW_PAGE_ID = "overview";

/** Package name of the Vue frontend module this package ships beside. */
export const FRONTEND_MODULE_NAME = "@antelopejs/dms-marketing-frontend-vue";

// =============================================================================
// Time
// =============================================================================

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
export const DAYS_PER_MONTH = 30;
export const DAYS_PER_YEAR = 365;
export const MAX_QUERY_PERIOD_DAYS = 90;
export const DEFAULT_QUERY_PERIOD_DAYS = 7;

// =============================================================================
// Collection Settings
// =============================================================================

export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * MS_PER_MINUTE;
export const DEFAULT_RAW_EVENTS_RETENTION_MS = 90 * MS_PER_DAY;
export const DEFAULT_STATISTICS_RETENTION_MS =
  (DAYS_PER_YEAR + DAYS_PER_MONTH) * MS_PER_DAY;

/**
 * 25 months — two full year-over-year windows, and the ceiling most privacy
 * regimes put on audience-measurement data.
 */
export const MAX_STATISTICS_RETENTION_DAYS = 760;
export const DEFAULT_HEATMAP_SAMPLE_RATIO = 0.1;
export const MAX_COLLECT_BATCH_SIZE = 25;
export const MAX_TRUSTED_CLIENT_CLOCK_SKEW_MS = 5 * MS_PER_MINUTE;

// =============================================================================
// Payload Limits
// =============================================================================

export const MAX_URL_LENGTH = 500;
export const MAX_TITLE_LENGTH = 200;
export const MAX_EVENT_NAME_LENGTH = 50;
export const MAX_EVENT_DATA_BYTES = 4096;
export const MAX_WEBSITE_ID_LENGTH = 64;
export const MAX_NAME_LENGTH = 100;
export const MAX_DOMAIN_LENGTH = 253;
export const MAX_EXTRA_DOMAINS = 20;
export const MAX_SCREEN_AND_LANGUAGE_CHARS = 16;

// =============================================================================
// Funnels
// =============================================================================

/** A single step is a conversion counter — a goal on its own. */
export const MIN_FUNNEL_STEPS = 1;
export const MAX_FUNNEL_STEPS = 10;
export const MAX_FUNNEL_STEP_VALUE_LENGTH = 500;
export const MAX_CONVERSION_WINDOW_HOURS = 720;
export const DEFAULT_CONVERSION_WINDOW_HOURS = 24;

// =============================================================================
// Experiments
// =============================================================================

export const MIN_EXPERIMENT_VARIATIONS = 2;
export const MAX_EXPERIMENT_VARIATIONS = 8;
export const MAX_EXPERIMENT_KEY_LENGTH = 64;
/** 8 hex chars = 32 bits — plenty for bucketing, cheap to parse. */
export const ASSIGNMENT_HASH_HEX_CHARS = 8;
export const EXPERIMENT_SIGNIFICANCE_LEVEL = 0.05;
/** SRM convention: alerting at .05 would cry wolf on every dashboard load. */
export const EXPERIMENT_SRM_P_THRESHOLD = 0.001;
/** Normal/chi-square approximations need this many outcomes per cell. */
export const MIN_OUTCOMES_PER_CELL = 5;

// =============================================================================
// Aggregation Settings
// =============================================================================

export const MAX_ENTRIES_PER_TOP_MAP = 50;

/**
 * Joins utm source, medium and campaign into one `topCampaigns` map key. The
 * unit separator is the one delimiter no keyboard produces: a UTM value could
 * still smuggle it in percent-encoded, in which case the key splits into
 * extra parts the read side ignores.
 */
export const CAMPAIGN_KEY_SEPARATOR = "\u001f";

/**
 * Past it a day row keeps its scalar counters and its maps are emptied by
 * the retention prune — no endpoint can read them anyway
 * (MAX_QUERY_PERIOD_DAYS bounds every window). Without the trim the bulk of
 * every row's size would outlive the only window able to read it.
 */
export const TOP_MAPS_RETENTION_DAYS = MAX_QUERY_PERIOD_DAYS;
export const DEFAULT_PAGES_LIST_LIMIT = 100;
export const MAX_PAGES_LIST_LIMIT = 200;
export const MAX_FUNNEL_EVENTS = 200_000;
export const MAX_HEATMAP_EVENTS = 50_000;
export const HEATMAP_DIVISIONS_PER_AXIS = 50;
/** Scroll depths arrive as integer percent (tracker PERCENT_SCALE). */
export const SCROLL_DEPTH_SCALE = 100;
/**
 * Anchored cells are keyed by selector, and selectors are only as stable as
 * the page's class names: a build that hashes them mints a fresh set per
 * deploy, and over the raw events' retention the response would grow with
 * every distinct selector ever clicked. The document grid needs no cap — it
 * is the grid that bounds it.
 */
export const MAX_ANCHORED_HEATMAP_CELLS = 2000;

// =============================================================================
// Page snapshots
// =============================================================================

/** Cap on one upload — the whole body, serialized document included. */
export const MAX_SNAPSHOT_BYTES = 1024 * 1024;
export const MAX_SNAPSHOTS_PER_WEBSITE = 1000;
export const MAX_REPORTED_SNAPSHOT_BYTES = 256 * 1024 * 1024;
export const MAX_SNAPSHOT_VIEWPORT_PX = 10_000;
export const MAX_SNAPSHOT_DOCUMENT_PX = 200_000;
export const DEFAULT_SNAPSHOT_RETENTION_MS = 30 * MS_PER_DAY;
/** A capture older than this is replaced by the next sampled visit. */
export const SNAPSHOT_REFRESH_AGE_MS = MS_PER_DAY;
/** How long one handed-out capture holds off the next for the same key. */
export const SNAPSHOT_PROMISE_TTL_MS = MS_PER_MINUTE;
export const SNAPSHOT_CACHE_MAX_ENTRIES = 10_000;

// =============================================================================
// Identity
// =============================================================================

export const VISITOR_ID_HEX_LENGTH = 32;
export const VISITOR_SECRET_BYTES = 32;
export const SESSION_CACHE_MAX_ENTRIES = 10_000;

// =============================================================================
// Caches
// =============================================================================

/** Legitimate cache keys number the deployment's websites (see bounded-cache). */
export const MAX_CACHE_ENTRIES = 1_000;
export const WEBSITE_CACHE_TTL_MS = 30_000;
export const EXPERIMENT_DEFINITIONS_CACHE_TTL_MS = 30_000;

// =============================================================================
// Ingestion guards
// =============================================================================

export const COLLECT_RATE_LIMIT_WINDOW_MS = MS_PER_MINUTE;
/** Per (website, IP); sized for CGNAT — an order of magnitude over one
 * heavy visitor. */
export const MAX_EVENTS_PER_WINDOW_PER_SOURCE = 600;
export const RATE_LIMIT_MAX_SOURCES = 50_000;
/** Per (website, IP): one legitimate visitor captures a handful per visit. */
export const MAX_SNAPSHOTS_PER_WINDOW_PER_SOURCE = 3;
export const TRACKER_CACHE_MAX_AGE_SECONDS = 3600;

// =============================================================================
// HTTP
// =============================================================================

export const API_BASE_PATH = "/api/marketing";

export const HTTP_BAD_REQUEST = 400;
export const HTTP_FORBIDDEN = 403;
export const HTTP_NOT_FOUND = 404;
export const HTTP_PAYLOAD_TOO_LARGE = 413;
