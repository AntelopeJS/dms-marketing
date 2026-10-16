<div align="center">

# @antelopejs/interface-dms-marketing

<a href="https://www.npmjs.com/package/@antelopejs/interface-dms-marketing"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/interface-dms-marketing?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/interface-dms-marketing?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a>
<a href="https://dms.antelopejs.com/docs/modules/marketing/extending"><img alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a>

The AntelopeJS interface to read aggregated first-party analytics of the DMS marketing module from any module.

</div>

## What it does

- Reads the click heatmap of one page path across a tenant's websites, aggregated on the implementer's grid (`GetClickHeatmap`).
- Returns normalised points with the clicked element's anchor, so an overlay stays stable across window sizes.
- Lets you show marketing data to tenant users on your own pages, since every `/modules/` page of the DMS is reserved to the platform owner.
- Keeps your module independent of the implementation, [`@antelopejs/dms-marketing`](https://www.npmjs.com/package/@antelopejs/dms-marketing).

## Install

Add the interface as an optional dependency of the module that reads analytics: calls reject when no module implements it, so your module can catch and degrade.

```bash
pnpm add --save-optional @antelopejs/interface-dms-marketing
```

## Quick start

```ts
import { GetClickHeatmap } from "@antelopejs/interface-dms-marketing";

export async function pricingHeatmap(tenantId: string) {
  try {
    return await GetClickHeatmap({ tenantId, path: "/pricing" });
  } catch {
    return null; // Analytics are optional for this page.
  }
}
```

Without `from` and `to`, the heatmap covers the last 7 days. Pass an authenticated tenant id only.

## Compatibility

The implementation is `@antelopejs/dms-marketing >=0.5.0`. The interface declares this peer dependency:

<!-- docs-compat: ./package.json#peerDependencies -->

| Package | Range |
| --- | --- |
| `@antelopejs/interface-core` | `>=0.2.3 <1.0.0` |

## Documentation

- [Consumer reference](./docs/1.index.md): heatmap query, results, limits and tenant boundaries
- [Extending the marketing module](https://dms.antelopejs.com/docs/modules/marketing/extending): the interface, the tracker's JavaScript API and the HTTP API
- [Marketing module guide](https://dms.antelopejs.com/docs/modules/marketing)

## Contributing

This package lives in the [`AntelopeJS/dms-marketing`](https://github.com/AntelopeJS/dms-marketing) pnpm workspace, next to the module that implements it. Read [CONTRIBUTING.md](https://github.com/AntelopeJS/dms-marketing/blob/main/CONTRIBUTING.md) and the [repository README](https://github.com/AntelopeJS/dms-marketing#contributing) for the development commands. Release this package before the module that implements it.

## License

[Apache-2.0](./LICENSE)
