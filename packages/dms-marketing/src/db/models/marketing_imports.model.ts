import { randomUUID } from "node:crypto";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  MarketingImport,
  marketingImportsTableName,
} from "../tables/marketing_imports.table";

/** The fields a holder writes to its import row as the import moves on. */
type FencedField =
  | "status"
  | "sessions"
  | "events"
  | "dropped"
  | "importedThrough"
  | "finishedAt";

export class MarketingImportsModel extends BasicDataModel(
  MarketingImport,
  marketingImportsTableName,
) {
  async listByWebsite(websiteId: string): Promise<MarketingImport[]> {
    return this.table.getAll(websiteId, "websiteId").run();
  }

  /**
   * Per website, the latest instant its completed imports filled (epoch ms):
   * activity no newer than it came from an import. Websites without a
   * completed import are absent.
   */
  async getImportedThroughByWebsites(
    websiteIds: string[],
  ): Promise<Map<string, number>> {
    const rows = await Promise.all(
      websiteIds.map((websiteId) => this.listByWebsite(websiteId)),
    );
    const through = new Map<string, number>();
    for (const row of rows.flat()) {
      if (row.status === "done" && row.importedThrough) {
        const at = new Date(row.importedThrough).getTime();
        through.set(
          row.websiteId,
          Math.max(through.get(row.websiteId) ?? at, at),
        );
      }
    }
    return through;
  }

  /**
   * Replaces the token of a claim still holding `token`: how its holder renews
   * it and how another instance takes over a claim whose holder stopped.
   *
   * @returns The new token, or undefined when the claim moved on
   */
  async swapClaim(id: string, token: string): Promise<string | undefined> {
    const next = randomUUID();
    const outcome = await this.table
      .atomicMutation(id, {
        type: "update",
        revisionField: "claimToken",
        expectedRevision: token,
        nextRevision: next,
        patch: {},
      })
      .run();
    if (outcome === "applied") return next;
    if (outcome === "not-applied") return undefined;
    const stored = await this.get(id);
    return stored?.claimToken === next ? next : undefined;
  }

  /**
   * Writes `patch` to an import row only while it still carries `fence`, and
   * installs `next` as its fence. An undefined `fence` matches a row with none.
   *
   * @returns Whether the row carried `fence` and took the write
   */
  async writeFenced(
    id: string,
    fence: string | undefined,
    next: string,
    patch: Partial<Pick<MarketingImport, FencedField>>,
  ): Promise<boolean> {
    const outcome = await this.table
      .atomicMutation(id, {
        type: "update",
        revisionField: "fence",
        expectedRevision: fence ?? { kind: "missing" },
        nextRevision: next,
        patch,
      })
      .run();
    if (outcome !== "unknown") return outcome === "applied";
    const stored = await this.get(id);
    return stored?.fence === next;
  }

  /** Never release an acquisition owned by another instance. */
  async releaseClaim(id: string, token: string): Promise<void> {
    const outcome = await this.table
      .atomicMutation(id, {
        type: "deleteIfEqual",
        field: "claimToken",
        expectedValue: token,
      })
      .run();
    if (outcome !== "applied") {
      throw new Error("Analytics import claim release was not confirmed");
    }
  }

  async deleteByWebsite(websiteId: string): Promise<number> {
    return this.table.getAll(websiteId, "websiteId").delete().run();
  }
}
