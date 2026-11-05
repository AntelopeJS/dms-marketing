---
covers:
  - packages/dms-marketing/src/config.ts
  - packages/dms-marketing/src/routes/dashboard-tracking.ts
  - packages/dms-marketing/src/services/dashboard-tracking.ts
  - packages/dms-marketing/src/services/geoip.ts
  - packages/dms-marketing/frontend-vue/app/plugins/dashboard-tracking.client.ts
  - packages/dms-marketing/frontend-vue/app/utils/dashboard-tracker.ts
  - packages/dms-marketing/src/frontend-module.ts
  - packages/dms-marketing/frontend-vue/dms.frontend.ts
docs:
  - packages/dms-marketing/docs/3.configuration.md
  - packages/dms-marketing/docs/2.installation.md
---

# Config

The module options: retentions, sampling, the collection option, the visitor hash secret and tracking of the dashboard itself.

## Sub-features

- `retention-and-sampling-options-set-what-settings-start-from`
- `the-visitor-hash-secret-feeds-the-visitor-identity`
- `dashboard-tracking-is-off-until-enabled-and-provisions-one-website`
- `the-collector-refuses-the-module-area-of-the-dashboards-website`
- `malformed-dashboard-tracking-values-fall-back-to-their-defaults`

## How to get to it (user POV)

- antelope.config.ts of the project; the dashboard loads the tracker on its own pages.

## Driving it with dms-control

```bash
dms-control journey "$RUN" config
```

## Gotchas

- `geoipDatabasePath` needs a MaxMind database the operator licenses; see Not driven in SKILL.md.
