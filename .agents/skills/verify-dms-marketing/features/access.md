---
covers:
  - packages/dms-marketing/src/routes/**
  - packages/dms-marketing/src/services/catalog.ts
docs:
  - packages/dms-marketing/docs/7.architecture/2.tenancy-and-access.md
  - packages/dms-marketing/docs/7.architecture/3.http-api.md
  - packages/dms-marketing/docs/6.faq.md
---

# Access

Who may call what: public routes, tenant members, tenant owners and the platform owner, route by route.

## Sub-features

- `every-route-answers-only-the-roles-its-level-names`

## How to get to it (user POV)

- A member of the workspace opens a Marketing page or calls the API.

## Driving it with dms-control

```bash
dms-control journey "$RUN" access
```

## Gotchas

- In a single-tenant DMS the owner of the default tenant is the platform owner, so the tenant-owner and platform-owner levels cannot be told apart; see Not driven in SKILL.md.
