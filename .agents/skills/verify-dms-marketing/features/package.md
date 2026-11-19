---
covers:
  - packages/dms-marketing/package.json
  - packages/dms-marketing/skills/**
  - packages/dms-marketing/frontend-vue/package.json
  - packages/dms-marketing/frontend-vue/build/**
  - packages/dms-marketing/frontend-vue/dms.frontend.build.ts
  - packages/interface-dms-marketing/package.json
  - packages/dms-marketing/frontend-vue/i18n/**
docs:
  - packages/dms-marketing/README.md
  - packages/dms-marketing/docs/2.installation.md
  - packages/dms-marketing/docs/7.architecture/8.frontend.md
  - packages/dms-marketing/KNOWN-ISSUES.md
---

# Package

What a project installs from the registry: the module with its build, dashboard layer, scripts and skill, the interface with its contract, and the ranges the compatibility table names.

## Sub-features

No journey: these need no running DMS, so `packages/dms-marketing/tests/package.test.js` checks them in the backend suite.

- the module's tarball holds the build, the dashboard layer, the agent skill and every path its manifest points at, without build info
- the interface's tarball holds its build and its consumer reference, and its root export carries the heatmap read, the four content calls and their types
- the README compatibility table lists the interface ranges the module depends on as packed, its interface-dms-marketing range accepts the interface in the tree, and the dashboard layer pins its renderer minor

## How to get to it (user POV)

- A project runs ajs project modules add @antelopejs/dms-marketing.

## Driving it

```bash
pnpm --dir packages/dms-marketing test:backend
```

## Gotchas

- None beyond the harness notes in SKILL.md.
