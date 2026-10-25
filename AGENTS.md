# dms-marketing

## Layout

A pnpm workspace with two published packages. The root holds the tool configs, the CI workflows and nothing else.

| Path                                  | What it is                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/dms-marketing`              | `@antelopejs/dms-marketing`, the DMS module: backend sources, static tracker, docs |
| `packages/dms-marketing/frontend-vue` | The Vue layer. ESLint and Prettier own it, not oxlint and oxfmt                    |
| `packages/dms-marketing/playground`   | A project of its own (`--ignore-workspace`), outside lint and format               |
| `packages/interface-dms-marketing`    | `@antelopejs/interface-dms-marketing`, the public contracts                        |

Each package keeps its own `pnpm-lock.yaml` (`shared-workspace-lockfile=false`). The module's lockfile resolves the interface from npm, not from the workspace sibling. Run a package script from its own directory: `pnpm --dir packages/dms-marketing <script>`.

## Versioning

The module implements the interface, so it depends on it as `>=<interface version> <0.<minor+1>.0`. `release.yml` refuses any other shape, and refuses to release the module until that interface version is on npm: run "Release DMS marketing interface" first.

## Tests

`pnpm run checks` runs only the Vue layer tests (`test:layer`). The backend suite runs in its own CI job. Run it when your change touches the module's backend:

- `pnpm --dir packages/dms-marketing test:backend` builds the interface and the module, then `ajs module test .` boots the module against a real DMS and an in-memory MongoDB replica set (`antelope.test.ts`). Set `DMS_PREBUILT=1` to reuse an existing build.
- `pnpm --dir packages/dms-marketing knip:all` also reports unused files and exports. Controllers, pages and modules are reached through decorators, so confirm each finding before you remove it.

## Orb

`.agents/setup` belongs to the guardrail pack. The MongoDB install, the build and the playground's module install live in `.agents/playground`, which the `dms-backend` service runs before it starts.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, ratchet, and sync, and prints only what failed. The change is done when it prints no failure.

The tools enforce most rules, listed in the table at the end. The sections below hold the rules no tool checks.

### Comments

Say it in code. A constraint belongs in a type, a lint rule, or a test. A public item's contract belongs in TSDoc (`/** */`) on that item. The only other comments are lint directives that name their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, `/*!` license headers, and bundler or formatter directives.

### Tests

Hold every test you write or keep to this checklist:

- Name the wrong implementation this test fails on. A test with no answer is deleted, not kept.
- No test reads the file it tests. Drive the behaviour through the public interface.
- An invariant over many files is a lint rule, not a test.

### Debt

`guardrails.ratchet.json` records the lint findings and oversize files this repository already had. Its numbers only go down. After you remove debt, run `pnpm run ratchet:update` and commit the lowered file. A rule listed there is off for `oxlint`. The ratchet counts it instead, and the pre-commit hook rejects it on every line you add.

### What enforces what

| Rule                                                                           | Enforced by                               |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Formatting                                                                     | oxfmt                                     |
| Lint findings are errors; no rule warns                                        | oxlint preset                             |
| Comments are TSDoc, directives, or `SAFETY:` only                              | `antelopejs/no-comments`                  |
| Every test asserts                                                             | `antelopejs/require-assertion`            |
| Tests read no files outside fixtures, helpers, locales                         | `antelopejs/no-fs-read-in-tests`          |
| No assertion that restates a constant                                          | `antelopejs/no-constant-value-assertion`  |
| No test whose only check is "is a function"                                    | `antelopejs/no-typeof-function-only-test` |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20 | `eslint/max-*`, `eslint/complexity`       |
| Files ≤ 20,000 bytes, tests included                                           | `antelopejs-check-size` (pre-commit)      |
| Existing debt only shrinks                                                     | `antelopejs-ratchet`                      |
| Types check                                                                    | `tsc` (pre-push)                          |
| No dead files, exports, or dependencies                                        | knip                                      |
| Managed files match the pack                                                   | `antelopejs-sync --check`                 |
| A test names the wrong implementation it catches                               | review; no tool                           |

<!-- antelopejs-guardrails:end -->
