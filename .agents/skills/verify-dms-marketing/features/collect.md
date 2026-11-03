---
covers:
  - packages/dms-marketing/src/routes/collect.ts
  - packages/dms-marketing/src/services/collect.ts
  - packages/dms-marketing/src/services/ingest-guard.ts
  - packages/dms-marketing/src/services/origin-guard.ts
  - packages/dms-marketing/src/services/request-body.ts
  - packages/dms-marketing/src/services/request-meta.ts
  - packages/dms-marketing/src/services/user-agent.ts
  - packages/dms-marketing/src/services/visitor-id.ts
  - packages/dms-marketing/src/services/url.ts
  - packages/dms-marketing/src/services/sessionize.ts
  - packages/dms-marketing/src/services/website-cache.ts
  - packages/dms-marketing/src/services/rollup-write.ts
  - packages/dms-marketing/src/types/events.ts
  - packages/dms-marketing/src/types/ua-parser-js-helpers.d.ts
  - packages/dms-marketing/src/db/models/marketing_events.model.ts
  - packages/dms-marketing/src/db/models/marketing_sessions.model.ts
  - packages/dms-marketing/src/db/tables/marketing_events.table.ts
  - packages/dms-marketing/src/db/tables/marketing_sessions.table.ts
  - packages/dms-marketing/src/utils/guards.ts
docs:
  - packages/dms-marketing/docs/7.architecture/3.http-api.md
  - packages/dms-marketing/docs/7.architecture/1.index.md
  - packages/dms-marketing/docs/2.installation.md
  - packages/dms-marketing/docs/6.faq.md
---

# Collect

`POST /api/marketing/collect` takes batches of 1 to 25 events from a tracked site, applies the guards in their documented order, stores thin events and rolls them up.

## Sub-features

- `a-batch-stores-thin-events-and-says-what-it-kept`
- `an-invalid-event-is-dropped-and-the-rest-of-the-batch-is-kept`
- `the-boundaries-of-a-batch-and-of-an-event`
- `long-context-text-is-cut-not-refused`
- `the-request-body-is-json-whatever-its-type-and-capped-at-256-kib`
- `the-browser-origin-must-be-the-website-or-a-subdomain-or-an-extra-domain`
- `automation-and-missing-user-agents-are-dropped-silently`
- `unknown-and-switched-off-websites-answer-404-and-a-paused-module-drops-everything`
- `a-source-is-limited-to-600-events-a-minute`
- `the-client-address-comes-from-trusted-proxies-only`
- `visitors-are-anonymous-hashes-of-the-website-the-address-and-the-agent`
- `a-pageview-opens-a-session-and-idle-time-ends-it`
- `a-referrer-of-the-site-itself-is-not-a-source`
- `a-pageview-keeps-only-a-sample-rate-in-its-data`
- `the-overview-reads-what-the-collector-rolled-up`

## How to get to it (user POV)

A visitor's browser posts to the backend from the tracked site. The snippet of the Websites page's install guide does it.

## Driving it with dms-control

```bash
dms-control journey "$RUN" collect
```

Requests are plain `fetch` calls with the headers a browser sets (`Origin`, a browser user agent). Stored rows are read with the MongoDB driver dms-control resolves.

## Gotchas

- The stored visitor id is a 32-character hex digest; the docs say `sha256(...)` and do not give the length.
- The rate limit is a window in memory: the journey sends 24 batches of 25 within one window.
- The exposure caps (64 and 65 characters) are not separable from the rule that only a running split accepts exposures; see `abtests`.
