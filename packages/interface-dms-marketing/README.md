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
- Declares page snapshots, the backdrops of the heatmaps, for pages the tracker cannot capture (`EnsurePageSnapshot`).
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

Declare content from a `Hook.TENANT_BEING_PROVISIONED` handler: the DMS fires it once per tenant, when the tenant is created (the `default` tenant included). All four content APIs require `tenantId`; omission, blank strings and surrounding whitespace reject. Marketing does not provision or authorize tenants.

```ts
import { Hook, RegisterHook } from "@antelopejs/interface-dms/hooks";
import { EnsureFunnel, EnsureWebsite } from "@antelopejs/interface-dms-marketing";

async function writeShopContent(tenantId: string) {
  await EnsureWebsite({ tenantId, id: "shop", name: "Shop", domain: "shop.example.com" });
  await EnsureFunnel({
    tenantId,
    id: "shop-checkout",
    websiteId: "shop",
    name: "Checkout",
    steps: [
      { kind: "url", value: "/cart" },
      { kind: "custom", value: "order_placed" },
    ],
  });
}

export function construct() {
  RegisterHook(Hook.TENANT_BEING_PROVISIONED, async ({ tenantId }) => {
    await writeShopContent(tenantId);
  });
}
```

## Compatibility

Interface 0.5.x needs a `@antelopejs/dms-marketing` release that implements it (the compatibility block of the [module README](../dms-marketing/README.md#compatibility) lists the interface range that module release supports). That release implements `GetClickHeatmap`, `EnsureWebsite`, `EnsureFunnel`, `EnsurePageSnapshot` and `ImportAnalytics`. Module 0.6.0 accepts interface versions `>=0.5.0 <0.6.0`. Older modules do not implement the new content calls; calling them waits for an implementation that never comes. Keep module 0.5.x paired with interface 0.4.x for the older heatmap-only contract. The interface declares this peer dependency:

<!-- antelopejs-docs-compat:start -->

| Package                      | Supported        | Tested with |
| ---------------------------- | ---------------- | ----------- |
| `@antelopejs/interface-core` | `>=0.2.4 <1.0.0` | —           |

<!-- antelopejs-docs-compat:end -->

## Documentation

- [Consumer reference](./docs/1.index.md): heatmap query, results, limits and tenant boundaries; content declarations and analytics imports
- [Extending the marketing module](https://dms.antelopejs.com/docs/modules/marketing/extending): the interface, the tracker's JavaScript API and the HTTP API
- [Marketing module guide](https://dms.antelopejs.com/docs/modules/marketing)

## Contributing

This package lives in the [`AntelopeJS/dms-marketing`](https://github.com/AntelopeJS/dms-marketing) pnpm workspace, next to the module that implements it. Read [CONTRIBUTING.md](https://github.com/AntelopeJS/dms-marketing/blob/main/CONTRIBUTING.md) and the [repository README](https://github.com/AntelopeJS/dms-marketing#contributing) for the development commands. Release this package before the module that implements it.

## License

[Apache-2.0](./LICENSE)
