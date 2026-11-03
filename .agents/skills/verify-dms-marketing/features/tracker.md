---
covers:
  - packages/dms-marketing/src/routes/tracker.ts
  - packages/dms-marketing/src/routes/public-endpoints.ts
  - packages/dms-marketing/src/services/static-script.ts
  - packages/dms-marketing/static/tracker/**
  - packages/dms-marketing/frontend-vue/app/components/TrackerSnippet.vue
  - packages/dms-marketing/frontend-vue/app/utils/snippet.ts
docs:
  - packages/dms-marketing/docs/4.usage/9.tracking.md
  - packages/dms-marketing/docs/2.installation.md
  - packages/dms-marketing/docs/7.architecture/3.http-api.md
---

# Tracker

The first-party tracker: automatic pageviews, SPA navigation, privacy signals, the page API, the served script and its settings.

## Sub-features

- `a-page-load-sends-a-pageview-with-its-context`
- `single-page-navigations-count-and-query-or-hash-updates-do-not`
- `do-not-track-and-global-privacy-control-are-honoured-unless-the-tag-opts-out`
- `custom-events-come-from-the-page-api`
- `an-excluded-page-sends-nothing`
- `the-website-id-of-the-tag-can-change`
- `the-served-script-carries-the-settings-and-a-stub-when-paused`

## How to get to it (user POV)

- A visitor opens a page of a tracked site; the page code calls window.dmsMarketing.

## Driving it with dms-control

```bash
dms-control journey "$RUN" tracker
```

## Gotchas

- None beyond the harness notes in SKILL.md.
