---
covers:
  - packages/dms-marketing/src/pages/acquisition/page.ts
  - packages/dms-marketing/src/services/acquisition.ts
  - packages/dms-marketing/src/services/acquisition-report.ts
  - packages/dms-marketing/frontend-vue/app/components/ChannelsCard.vue
  - packages/dms-marketing/frontend-vue/app/utils/channels.ts
docs:
  - packages/dms-marketing/docs/4.usage/2.acquisition.md
---

# Acquisition

Acquisition: how a session gets its channel, the campaigns table and the referrer, content and term lists.

## Sub-features

- `paid-mediums-and-ad-click-ids`
- `email-mediums`
- `social-networks-and-mediums`
- `organic-search-engines`
- `referral-and-direct`
- `no-referrer-is-direct`
- `the-first-matching-rule-wins`
- `the-campaigns-table-groups-by-triple-and-channel`
- `the-campaigns-table-pages-25-rows-at-a-time`
- `referrers-and-the-lists-behind-the-campaigns`

## How to get to it (user POV)

- Modules > Marketing > Acquisition.

## Driving it with dms-control

```bash
dms-control journey "$RUN" acquisition
```

## Gotchas

- None beyond the harness notes in SKILL.md.
