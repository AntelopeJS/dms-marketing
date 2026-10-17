<div align="center">

# @antelopejs/interface-dms-marketing

<a href="https://www.npmjs.com/package/@antelopejs/interface-dms-marketing"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/interface-dms-marketing?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/interface-dms-marketing?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a>
<a href="https://dms.antelopejs.com/docs/modules/marketing/extending"><img alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a>

The AntelopeJS interface to read aggregated first-party analytics of the DMS marketing module from any module, and to ship marketing content as code.

</div>

## What it does

- Reads the click heatmap of one page path across a tenant's websites, aggregated on the implementer's grid (`GetClickHeatmap`).
- Returns normalised points with the clicked element's anchor, so an overlay stays stable across window sizes.
- Lets you show marketing data to tenant users on your own pages, since every `/modules/` page of the DMS is reserved to the platform owner.
- Declares websites and funnels with their A/B splits from code, idempotently and without overwriting what a user changed (`EnsureWebsite`, `EnsureFunnel`).
- Imports historical analytics through the live collection pipeline, once per import id (`ImportAnalytics`): demo instances and migrations from another tool.
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

Ship content from your module's `start()`; each call is safe on every boot:

```ts
import { EnsureFunnel, EnsureWebsite } from "@antelopejs/interface-dms-marketing";

export async function start() {
  await EnsureWebsite({ id: "shop", name: "Shop", domain: "shop.example.com" });
  await EnsureFunnel({
    id: "shop-checkout",
    websiteId: "shop",
    name: "Checkout",
    steps: [
      { kind: "url", value: "/cart" },
      { kind: "custom", value: "order_placed" },
    ],
  });
}
```

## Compatibility

The implementation is `@antelopejs/dms-marketing`: `>=0.5.0` for `GetClickHeatmap`, and the first release after 0.5.1 for `EnsureWebsite`, `EnsureFunnel` and `ImportAnalytics` — against an older one, those calls wait for an implementation that never comes. The interface declares this peer dependency:

<!-- docs-compat: ./package.json#peerDependencies -->

| Package | Range |
| --- | --- |
| `@antelopejs/interface-core` | `>=0.2.4 <1.0.0` |

## Documentation

- [Consumer reference](./docs/1.index.md): heatmap query, results, limits and tenant boundaries; content declarations and analytics imports
- [Extending the marketing module](https://dms.antelopejs.com/docs/modules/marketing/extending): the interface, the tracker's JavaScript API and the HTTP API
- [Marketing module guide](https://dms.antelopejs.com/docs/modules/marketing)

## Contributing

This package lives in the [`AntelopeJS/dms-marketing`](https://github.com/AntelopeJS/dms-marketing) pnpm workspace, next to the module that implements it. Read [CONTRIBUTING.md](https://github.com/AntelopeJS/dms-marketing/blob/main/CONTRIBUTING.md) and the [repository README](https://github.com/AntelopeJS/dms-marketing#contributing) for the development commands. Release this package before the module that implements it.

## License

[Apache-2.0](./LICENSE)
