---
covers:
  - packages/dms-marketing/src/pages/funnels/page.ts
  - packages/dms-marketing/src/pages/funnel/page.ts
  - packages/dms-marketing/src/pages/funnel-builder/page.ts
  - packages/dms-marketing/src/routes/funnels.ts
  - packages/dms-marketing/src/data-api/funnels.ts
  - packages/dms-marketing/src/services/funnels/**
  - packages/dms-marketing/src/services/funnel-report.ts
  - packages/dms-marketing/src/services/funnels-table.ts
  - packages/dms-marketing/src/services/tenant-funnel.ts
  - packages/dms-marketing/src/db/models/funnels.model.ts
  - packages/dms-marketing/src/db/tables/funnels.table.ts
  - packages/dms-marketing/src/utils/funnel-steps-type.ts
  - packages/dms-marketing/frontend-vue/app/components/FunnelBuilder.vue
  - packages/dms-marketing/frontend-vue/app/components/FunnelFigure.vue
  - packages/dms-marketing/frontend-vue/app/components/FunnelReport.vue
  - packages/dms-marketing/frontend-vue/app/components/FunnelStepsInput.vue
  - packages/dms-marketing/frontend-vue/app/components/FunnelTemplates.vue
  - packages/dms-marketing/frontend-vue/app/build/components/funnel-builder/FunnelBuilderPreview.vue
  - packages/dms-marketing/frontend-vue/app/build/components/funnel-builder/FunnelBuilderSteps.vue
  - packages/dms-marketing/frontend-vue/app/build/components/funnel-builder/FunnelBuilderSuggestions.vue
  - packages/dms-marketing/frontend-vue/app/build/components/funnel-figure/**
  - packages/dms-marketing/frontend-vue/app/build/composables/useDraftLoad.ts
  - packages/dms-marketing/frontend-vue/app/build/composables/useDraftPreview.ts
  - packages/dms-marketing/frontend-vue/app/build/composables/useDraftSave.ts
  - packages/dms-marketing/frontend-vue/app/build/composables/useStepSuggestions.ts
  - packages/dms-marketing/frontend-vue/app/composables/useCopyDraft.ts
  - packages/dms-marketing/frontend-vue/app/composables/useFunnelSteps.ts
  - packages/dms-marketing/frontend-vue/app/utils/funnel-draft.ts
  - packages/dms-marketing/frontend-vue/app/utils/step-path.ts
  - packages/dms-marketing/frontend-vue/app/plugins/funnel-steps-data-type.client.ts
  - packages/dms-marketing/frontend-vue/app/build/types/funnelBuilder.ts
docs:
  - packages/dms-marketing/docs/4.usage/5.funnels.md
  - packages/dms-marketing/docs/7.architecture/3.http-api.md
---

# Funnels

Funnels: step matching, the list, templates, the builder rules, the report and deletion.

## Sub-features

- `steps-match-in-order-within-a-session`
- `a-trailing-star-matches-every-path-below`
- `the-conversion-window-bounds-the-journey`
- `the-preview-and-the-builder-rules-refuse-what-cannot-be-scored`
- `templates-suggestions-and-the-list-banner`
- `the-builder-saves-edits-and-deletes-a-funnel-under-its-rules`

## How to get to it (user POV)

- Modules > Marketing > Funnels & A/B tests.

## Driving it with dms-control

```bash
dms-control journey "$RUN" funnels
```

## Gotchas

- None beyond the harness notes in SKILL.md.
