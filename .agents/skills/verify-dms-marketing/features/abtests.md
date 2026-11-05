---
covers:
  - packages/dms-marketing/src/routes/experiments.ts
  - packages/dms-marketing/src/services/experiments/**
  - packages/dms-marketing/src/services/experiment-definitions.ts
  - packages/dms-marketing/src/utils/experiment-type.ts
  - packages/dms-marketing/src/types/constants.ts
  - packages/dms-marketing/frontend-vue/app/components/ExperimentInput.vue
  - packages/dms-marketing/frontend-vue/app/components/ExperimentReport.vue
  - packages/dms-marketing/frontend-vue/app/components/VariationsInput.vue
  - packages/dms-marketing/frontend-vue/app/build/components/experiment-report/**
  - packages/dms-marketing/frontend-vue/app/build/components/funnel-builder/FunnelBuilderSplit.vue
  - packages/dms-marketing/frontend-vue/app/build/composables/useDraftVariations.ts
  - packages/dms-marketing/frontend-vue/app/composables/useExperiment.ts
docs:
  - packages/dms-marketing/docs/4.usage/6.ab-tests.md
  - packages/dms-marketing/docs/7.architecture/6.ab-assignment.md
---

# Abtests

A/B tests: the assignment script, the reading per arm, the verdicts and the split check.

## Sub-features

- `an-arm-is-scored-per-exposed-session-with-a-two-sided-z-test`
- `a-significant-reading-is-ready-after-a-week-and-50-conversions-per-arm`
- `a-challenger-below-the-control-and-a-flat-reading-and-a-thin-sample`
- `a-sample-ratio-mismatch-withholds-the-verdict`
- `the-assignment-script-serves-running-splits-per-visitor`
- `each-split-draws-its-own-arm-and-the-weights-set-the-shares`
- `a-split-has-2-to-8-variations`
- `keys-start-with-a-letter-or-digit-and-hold-lowercase-digits-dash-underscore`
- `weights-are-zero-or-more-and-one-is-above-zero`
- `each-challenger-is-tested-at-0-05-over-the-number-of-challengers`
- `a-split-moves-draft-running-stopped-and-freezes-its-key-and-variations`

## How to get to it (user POV)

- A funnel report of a split; the page calls window.dmsMarketing.variation().

## Driving it with dms-control

```bash
dms-control journey "$RUN" abtests
```

## Gotchas

- None beyond the harness notes in SKILL.md.
