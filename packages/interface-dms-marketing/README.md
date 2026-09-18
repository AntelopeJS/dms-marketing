# @antelopejs/interface-dms-marketing

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

AntelopeJS interface for the DMS marketing module (`@antelopejs/dms-marketing`):
read aggregated first-party analytics from any module.

- **Implemented by** `@antelopejs/dms-marketing` (declared in its
  `antelopeJs.implements`).
- **Consumed by** modules that want marketing data without a hard dependency —
  declare this package in `optionalDependencies`: calls reject when no
  implementer is loaded, so consumers catch and degrade gracefully. No
  in-tree consumer today: dms-api dropped its route heatmap tab.

## Surface

- `GetClickHeatmap(query)` — click heatmap of one page path across a tenant's
  websites, aggregated on the implementer's grid.

## Availability detection

```ts
import { GetInterfaceInstances } from "@antelopejs/interface-core";

const available =
  GetInterfaceInstances("@antelopejs/interface-dms-marketing").length > 0;
```
