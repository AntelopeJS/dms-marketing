# dms-marketing

Workspace holding the AntelopeJS DMS marketing module and the interface
package it implements.

| Package | Directory | Published as |
|---|---|---|
| Marketing module | [`packages/dms-marketing`](packages/dms-marketing) | `@antelopejs/dms-marketing` |
| Marketing interface | [`packages/interface-dms-marketing`](packages/interface-dms-marketing) | `@antelopejs/interface-dms-marketing` |

Both are published publicly on npm under the `@antelopejs` scope (npm trusted
publishing, with provenance) and released independently from
`.github/workflows/release.yml` and `.github/workflows/release-interface.yml`.

Start with the module's own [README](packages/dms-marketing/README.md).

## Development

```bash
pnpm install --filter @antelopejs/dms-marketing... --frozen-lockfile
pnpm build      # builds the interface, then the module
pnpm lint       # oxlint + oxfmt, both packages, then eslint over frontend-vue
pnpm typecheck  # tsc over both packages, skipLibCheck off
pnpm knip       # unused dependencies
pnpm test       # backend suite, then the frontend module's vitest suite
```
