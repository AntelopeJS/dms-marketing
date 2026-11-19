# dms-marketing

## Layout

A pnpm workspace with two published packages. The root holds the tool configs, the CI workflows and `e2e/`, the Playwright suite of the verify skill's journeys that open a tab, with the dependencies they run on (`@antelopejs/dms` for its `e2e` kit, `@playwright/test`); no source code.

| Path                                  | What it is                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/dms-marketing`              | `@antelopejs/dms-marketing`, the DMS module: backend sources, static tracker, docs |
| `packages/dms-marketing/frontend-vue` | The Vue layer. ESLint and Prettier own it, not oxlint and oxfmt                    |
| `packages/dms-marketing/playground`   | A project of its own (`--ignore-workspace`), outside lint and format               |
| `packages/interface-dms-marketing`    | `@antelopejs/interface-dms-marketing`, the public contracts                        |

Each package keeps its own `pnpm-lock.yaml` (`shared-workspace-lockfile=false`). The module's lockfile links the interface from the workspace sibling, and the root `typecheck` builds the interface first so the module's typecheck and lint resolve it. Run a package script from its own directory: `pnpm --dir packages/dms-marketing <script>`.

## Versioning

The module names the interface as `workspace:^`, so `pnpm pack` writes `^<interface version in the tree>` and no release hook rewrites it. Release the interface before the module. The interface's release commit runs `sync`, which refreshes the README compatibility table. `release.yml` releases each package through the shared `release-npm-public.yml@v2`.

## Tests

`pnpm run checks` runs only the Vue layer tests (`test:layer`). The backend suite runs in its own CI job. Run it when your change touches the module's backend:

- `pnpm --dir packages/dms-marketing test:backend` builds the interface and the module, then `ajs module test .` boots the module against a real DMS and an in-memory MongoDB replica set (`antelope.test.ts`), and `test:journeys` runs the journeys that call only the HTTP API in a second boot. Set `DMS_PREBUILT=1` to reuse an existing build.
- `test:journeys` runs `tests/<feature>.journeys.js`, one per feature, each declaring a test per journey of `tests/journeys/<feature>.mjs` through `tests/helpers/journeys.js`: the API on the port `antelope.test.ts` picks, the playground's `/verify-marketing` calls made in process, and every marketing table emptied before each journey. Their file names leave them out of the unit run, whose tests mock models and clocks the journeys need real.
- `packages/dms-marketing/antelope-lock/` records the lockfile of each package module `antelope.test.ts` installs, so every run, cached or not, installs the same dependencies. After you change a version there, delete the records of the old versions, run `test:backend` once, and commit the new records it writes.
- `pnpm e2e` runs the journeys that open a tab (`e2e/journeys/`) as a Playwright suite: the kit's global setup runs the skill's `prepare` and starts one run, every journey runs on that run, and the run stops after the last. `pnpm e2e --grep @smoke` runs the journeys tagged `@smoke`, as the `e2e` job of `ci.yml` does on a ready pull request; a `merge_group` run, a manual dispatch, the nightly and a pull request labelled `ci:full` run every journey in two shards. `pnpm e2e -g <feature or journey id>` runs a part of it.
- `pnpm --dir packages/dms-marketing knip:all` also reports unused files and exports. The exports of `src/frontend-module.ts` are reached through `dmsFrontend` in `package.json`; confirm every other finding before you remove it.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

CI runs `pnpm run checks` in full on every pull request and reports what failed. The commit hook formats and lints the staged files. Locally, run only the fast check for what you touched:

- `pnpm run typecheck` after you change types or signatures.
- `pnpm exec oxlint <files>` and `pnpm exec oxfmt <files>` on the files you changed.
- One test file, not the suite. In a module that tests with `ajs module test`: `pnpm run build`, then `pnpm exec ajs module test . -f dist/<path>.test.js`.

Prove a change works with the verification skill in [`.agents/skills/verify-dms-marketing/SKILL.md`](.agents/skills/verify-dms-marketing/SKILL.md) before you call it done.

### Comments

Say it in code: a constraint in a type, a lint rule or a test, a public item's contract in TSDoc. Other comments are lint directives naming their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, and license or tool directives. A reason states what the code does now.

### Tests

Each test names the wrong implementation it fails on, or is deleted. Drive behaviour through the public interface. An invariant over many files is a lint rule.

### Review

No tool checks these:

- A type guard checks the nested elements and values it claims.
- A no-upward import rule rejects same-tier peers; probe it with an import.
- A finding only an evasion or a patched internal can trigger goes under Attention and never blocks.

### Suppressions

`guardrails.suppressions.json` caps lint directives, `@ts-expect-error`, `SAFETY:` comments and rules a lint config turns off. Over a cap, fix the code or remove another suppression of that kind; only the operator raises a number. After removing suppressions, run `pnpm run suppressions:update` and commit the file.

<!-- antelopejs-guardrails:end -->
