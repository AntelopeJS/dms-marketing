---
covers:
  - packages/dms-marketing/src/pages/pages/page.ts
  - packages/dms-marketing/src/services/heatmap.ts
  - packages/dms-marketing/src/services/workspace-scope.ts
  - packages/dms-marketing/frontend-vue/app/components/PagesExplorer.vue
  - packages/dms-marketing/frontend-vue/app/components/HeatmapCanvas.vue
  - packages/dms-marketing/frontend-vue/app/components/ScrollDepthOverlay.vue
  - packages/dms-marketing/frontend-vue/app/components/WorkspaceScope.vue
  - packages/dms-marketing/frontend-vue/app/build/components/pages-explorer/**
  - packages/dms-marketing/frontend-vue/app/utils/heatmap.ts
  - packages/dms-marketing/frontend-vue/app/utils/heatmapPalette.ts
  - packages/dms-marketing/frontend-vue/app/utils/anchor-drift.ts
  - packages/dms-marketing/frontend-vue/app/utils/drift-dismissals.ts
  - packages/dms-marketing/frontend-vue/app/utils/workspace-scope.ts
  - packages/dms-marketing/frontend-vue/app/utils/sample-size.ts
  - packages/dms-marketing/frontend-vue/app/utils/fill-height.ts
  - packages/dms-marketing/src/routes/stats.ts
docs:
  - packages/dms-marketing/docs/4.usage/3.pages-and-heatmaps.md
  - packages/dms-marketing/docs/7.architecture/5.snapshots-and-heatmaps.md
  - packages/dms-marketing/docs/6.faq.md
---

# Pages

Pages and heatmaps: the observed paths, clicks anchored to elements, scroll depth, the sampling note and the reset.

## Sub-features

- `the-pages-list-gives-views-clicks-and-sorts`
- `the-page-list-keeps-50-paths-a-day-and-the-heatmap-read-is-not-lossy`
- `clicks-stick-to-elements-and-fall-back-to-document-cells`
- `scroll-depth-counts-the-views-that-reached-each-depth`
- `a-heatmap-reset-deletes-one-path-and-counts-what-it-deletes`
- `the-sample-rate-is-the-average-of-the-declared-rates-over-enough-views`

## How to get to it (user POV)

- Modules > Marketing > Pages & heatmaps.

## Driving it with dms-control

```bash
dms-control journey "$RUN" pages
```

## Gotchas

- The workspace read needs two workspaces with a dashboard website; see Not driven in SKILL.md.
