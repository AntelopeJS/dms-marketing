---
covers:
  - packages/dms-marketing/src/routes/snapshot.ts
  - packages/dms-marketing/src/services/snapshots.ts
  - packages/dms-marketing/src/services/snapshot-html.ts
  - packages/dms-marketing/static/snapshot/**
  - packages/dms-marketing/src/types/snapshots.ts
  - packages/dms-marketing/src/db/models/page_snapshots.model.ts
  - packages/dms-marketing/src/db/tables/page_snapshots.table.ts
  - packages/dms-marketing/frontend-vue/app/components/PagePreview.vue
  - packages/dms-marketing/frontend-vue/app/build/components/page-preview/**
  - packages/dms-marketing/frontend-vue/app/build/composables/usePreview*.ts
  - packages/dms-marketing/frontend-vue/app/build/composables/useFillPanes.ts
  - packages/dms-marketing/frontend-vue/app/composables/useSnapshotFrame.ts
  - packages/dms-marketing/frontend-vue/app/utils/page-snapshot.ts
  - packages/dms-marketing/frontend-vue/app/utils/snapshot-options.ts
  - packages/dms-marketing/frontend-vue/app/utils/snapshotScrollRoot.ts
  - packages/dms-marketing/frontend-vue/app/utils/snapshotViewportUnits.ts
  - packages/dms-marketing/frontend-vue/app/build/types/pagePreview.ts
docs:
  - packages/dms-marketing/docs/4.usage/4.page-snapshots.md
  - packages/dms-marketing/docs/7.architecture/5.snapshots-and-heatmaps.md
  - packages/dms-marketing/docs/4.usage/3.pages-and-heatmaps.md
---

# Snapshots

Page snapshots: the negotiation, the upload and its guards, the server-side sanitising, retention switches and the capture in a real browser.

## Sub-features

- `the-backend-asks-for-a-capture-only-when-it-wants-one`
- `an-upload-needs-its-token-its-visitor-and-its-page`
- `uploads-are-limited-to-3-a-minute-per-source`
- `the-upload-cap-is-the-configured-size-clamped-between-64-kib-and-8-mib`
- `the-stored-document-is-sanitised-again-on-the-server`
- `a-capture-is-not-refreshed-within-a-day-and-an-option-change-discards-the-captures`
- `a-sampled-visit-clicks-scrolls-and-captures-the-page-in-the-browser`

## How to get to it (user POV)

- Modules > Marketing > Pages & heatmaps (the preview); the tracker captures sampled visits.

## Driving it with dms-control

```bash
dms-control journey "$RUN" snapshots
```

## Gotchas

- None beyond the harness notes in SKILL.md.
