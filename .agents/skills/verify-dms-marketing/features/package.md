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

- `the-module-tarball-holds-what-its-manifest-names`
- `the-interface-tarball-exports-the-contract`
- `ranges-match-the-compatibility-table`

## How to get to it (user POV)

- A project runs ajs project modules add @antelopejs/dms-marketing.

## Driving it with dms-control

```bash
dms-control journey "$RUN" package
```

## Gotchas

- None beyond the harness notes in SKILL.md.
