---
covers:
  - packages/dms-marketing/src/services/declarations.ts
  - packages/dms-marketing/src/services/declared-funnel.ts
  - packages/dms-marketing/src/services/declared-snapshot.ts
  - packages/dms-marketing/src/services/declared-website.ts
  - packages/dms-marketing/src/services/analytics-import.ts
  - packages/dms-marketing/src/services/analytics-import-claim.ts
  - packages/dms-marketing/src/services/analytics-import-replay.ts
  - packages/dms-marketing/src/db/models/marketing_imports.model.ts
  - packages/dms-marketing/src/db/tables/marketing_imports.table.ts
  - packages/dms-marketing/src/hooks/index.ts
  - packages/dms-marketing/src/implementations/dms-marketing/index.ts
  - packages/interface-dms-marketing/src/**
docs:
  - packages/dms-marketing/docs/5.extending.md
  - packages/dms-marketing/docs/7.architecture/7.interface.md
  - packages/interface-dms-marketing/README.md
  - packages/interface-dms-marketing/docs/1.index.md
---

# Content

Content from code: EnsureWebsite, EnsureFunnel, EnsurePageSnapshot, ImportAnalytics and the heatmap read of the interface.

## Sub-features

- `a-declared-website-is-written-once-by-its-id`
- `every-content-call-needs-an-explicit-tenant`
- `a-declared-funnel-follows-the-funnel-rules`
- `a-declared-snapshot-needs-a-website-that-opted-in-and-never-replaces-a-capture`
- `an-import-replays-history-once-through-the-collect-pipeline`
- `the-heatmap-read-takes-a-tenant-a-path-and-a-window`

## How to get to it (user POV)

- A backend module calls the interface from its provisioning hook.

## Driving it with dms-control

```bash
dms-control journey "$RUN" content
```

## Gotchas

- None beyond the harness notes in SKILL.md.
