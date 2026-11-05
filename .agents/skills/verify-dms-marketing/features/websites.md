---
covers:
  - packages/dms-marketing/src/routes/websites.ts
  - packages/dms-marketing/src/data-api/websites.ts
  - packages/dms-marketing/src/data-api/body.ts
  - packages/dms-marketing/src/data-api/hidden-filter.ts
  - packages/dms-marketing/src/data-api/tenant-scope.ts
  - packages/dms-marketing/src/data-api/index.ts
  - packages/dms-marketing/src/services/tenant-website.ts
  - packages/dms-marketing/src/utils/zod-json.ts
  - packages/dms-marketing/src/services/website-report.ts
  - packages/dms-marketing/src/services/website-rules.ts
  - packages/dms-marketing/src/services/website-hosts.ts
  - packages/dms-marketing/src/db/models/websites.model.ts
  - packages/dms-marketing/src/db/tables/websites.table.ts
  - packages/dms-marketing/src/pages/websites/page.ts
  - packages/dms-marketing/src/pages/install/page.ts
  - packages/dms-marketing/frontend-vue/app/components/WebsiteCard.vue
  - packages/dms-marketing/frontend-vue/app/components/WebsiteCreate.vue
  - packages/dms-marketing/frontend-vue/app/components/WebsiteSettings.vue
  - packages/dms-marketing/frontend-vue/app/components/WebsitePicker.vue
  - packages/dms-marketing/frontend-vue/app/components/InstallGuide.vue
  - packages/dms-marketing/frontend-vue/app/build/components/install-guide/**
  - packages/dms-marketing/frontend-vue/app/utils/website-*.ts
  - packages/dms-marketing/frontend-vue/app/utils/host-conflict.ts
docs:
  - packages/dms-marketing/docs/4.usage/7.websites.md
  - packages/dms-marketing/docs/7.architecture/2.tenancy-and-access.md
  - packages/dms-marketing/docs/7.architecture/3.http-api.md
---

# Websites

Websites: registration and its rules, state, the install guide checks, purges and deletion, and the Websites page.

## Sub-features

- `a-website-is-registered-with-normalised-hosts`
- `a-host-belongs-to-one-website-of-the-workspace`
- `an-update-changes-only-the-keys-it-carries`
- `a-website-is-waiting-then-live-and-its-connection-is-readable`
- `a-refused-browser-host-can-be-allowed-from-the-install-guide`
- `purges-and-deletion-take-only-the-sites-own-data`
- `the-websites-page-adds-lists-pauses-and-resumes-a-site`

## How to get to it (user POV)

- Modules > Marketing > Websites.

## Driving it with dms-control

```bash
dms-control journey "$RUN" websites
```

## Gotchas

- None beyond the harness notes in SKILL.md.
