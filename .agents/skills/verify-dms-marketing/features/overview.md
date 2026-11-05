---
covers:
  - packages/dms-marketing/src/pages/overview/page.ts
  - packages/dms-marketing/src/pages/module.ts
  - packages/dms-marketing/src/pages/blocks.ts
  - packages/dms-marketing/src/pages/quick-actions.ts
  - packages/dms-marketing/src/routes/context.ts
  - packages/dms-marketing/src/routes/blocks.ts
  - packages/dms-marketing/src/services/dashboard.ts
  - packages/dms-marketing/src/services/composed.ts
  - packages/dms-marketing/src/services/rollups.ts
  - packages/dms-marketing/src/services/hourly-traffic.ts
  - packages/dms-marketing/src/services/period.ts
  - packages/dms-marketing/src/services/context.ts
  - packages/dms-marketing/src/services/realtime.ts
  - packages/dms-marketing/src/services/query-param.ts
  - packages/dms-marketing/src/types/statistics.ts
  - packages/dms-marketing/src/db/models/website_statistics.model.ts
  - packages/dms-marketing/src/db/models/marketing_preferences.model.ts
  - packages/dms-marketing/src/db/tables/website_statistics.table.ts
  - packages/dms-marketing/src/db/tables/marketing_preferences.table.ts
  - packages/dms-marketing/frontend-vue/app/components/Context.vue
  - packages/dms-marketing/frontend-vue/app/components/TopListTabs.vue
  - packages/dms-marketing/frontend-vue/app/components/FirstRun.vue
  - packages/dms-marketing/frontend-vue/app/composables/useContext*.ts
  - packages/dms-marketing/frontend-vue/app/composables/useMarketing*.ts
  - packages/dms-marketing/frontend-vue/app/composables/useLatestRequest.ts
  - packages/dms-marketing/frontend-vue/app/composables/useRecordCrumb.ts
  - packages/dms-marketing/frontend-vue/app/utils/format.ts
  - packages/dms-marketing/frontend-vue/app/constants.ts
docs:
  - packages/dms-marketing/docs/4.usage/1.overview.md
  - packages/dms-marketing/docs/7.architecture/4.context-and-period.md
  - packages/dms-marketing/docs/7.architecture/3.http-api.md
---

# Overview

The Overview: context bar, period and comparison, KPI cards, session quality, traffic chart, devices and the tabbed top lists.

## Sub-features

- `the-kpi-cards-change-against-the-comparison-window`
- `the-traffic-chart-and-the-quality-strip`
- `devices-and-the-tabbed-top-lists`
- `the-context-bar-picks-a-website-and-remembers-it`
- `a-read-without-a-period-covers-today-and-the-6-days-before`

## How to get to it (user POV)

- Modules > Marketing > Overview.

## Driving it with dms-control

```bash
dms-control journey "$RUN" overview
```

## Gotchas

- None beyond the harness notes in SKILL.md.
