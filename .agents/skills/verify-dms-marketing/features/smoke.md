---
covers:
  - packages/dms-marketing/src/index.ts
  - packages/dms-marketing/src/hooks/index.ts
  - packages/dms-marketing/src/db/index.ts
  - packages/dms-marketing/src/pages/all.ts
  - packages/dms-marketing/src/pages/index.ts
  - packages/dms-marketing/src/routes/index.ts
  - packages/dms-marketing/src/services/index.ts
  - packages/dms-marketing/src/types/index.ts
  - packages/dms-marketing/src/types/json.ts
docs:
  - packages/dms-marketing/README.md
  - packages/dms-marketing/docs/1.introduction.md
---

# Smoke

The fixed journey every verdict runs: add a website, send a visit, read the pageview in the Overview.

## Sub-features

- `smoke`

## How to get to it (user POV)

- Modules > Marketing > Websites > Add a website; the install guide.

## Driving it with dms-control

```bash
dms-control journey "$RUN" smoke
```

## Gotchas

- None beyond the harness notes in SKILL.md.
