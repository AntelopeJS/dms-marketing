---
covers:
  - packages/dms-marketing/src/routes/settings.ts
  - packages/dms-marketing/src/services/settings.ts
  - packages/dms-marketing/src/types/settings.ts
  - packages/dms-marketing/src/pages/settings/**
  - packages/dms-marketing/src/db/models/marketing_settings.model.ts
  - packages/dms-marketing/src/db/tables/marketing_settings.table.ts
docs:
  - packages/dms-marketing/docs/4.usage/8.settings.md
  - packages/dms-marketing/docs/3.configuration.md
  - packages/dms-marketing/docs/7.architecture/3.http-api.md
---

# Settings

The Settings page: the master switch, the three retentions, sampling, their bounds and the confirmation of a destructive cut.

## Sub-features

- `the-settings-start-from-the-configuration-defaults`
- `values-out-of-bounds-are-refused-under-their-field-never-clamped`
- `retentions-keep-their-order`
- `a-save-merges-and-null-or-the-default-follows-the-configuration`
- `a-retention-cut-that-deletes-data-asks-before-it-applies`

## How to get to it (user POV)

- Modules > Marketing > Settings (platform owner).

## Driving it with dms-control

```bash
dms-control journey "$RUN" settings
```

## Gotchas

- None beyond the harness notes in SKILL.md.
