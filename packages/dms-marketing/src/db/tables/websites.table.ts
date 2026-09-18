import {
  Field,
  Index,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const websitesTableName = "marketing_websites";

/**
 * A tracked website — the unit of collection and the tenancy bridge: the
 * public collect endpoint carries no JWT, so events reference a website id
 * and every authenticated read resolves the caller's tenant against
 * `tenantId`. The one marketing table that must stay global (dms-core
 * schema): it routes anonymous beacons to the right per-tenant instance.
 */
@RegisterTable(websitesTableName, CORE_SCHEMA_NAME)
export class Website extends Table {
  @Index()
  @Field("string")
  declare tenantId: string;

  @Field("string")
  declare name: string;

  @Field("string")
  declare domain: string;

  /** Hosts beyond `domain` the site also serves from; both gate ingestion
   * (see services/origin-guard.ts). */
  @Field(["string"])
  declare extraDomains?: string[];

  /** Per-site kill switch; the global one lives in the module settings. */
  @Field("boolean")
  declare trackingEnabled: boolean;

  /** Opt-in: snapshots store page content, which the rest of the module
   * never does. */
  @Field("boolean")
  declare snapshotsEnabled: boolean;

  /** Every text node of a capture masked, not just form values. */
  @Field("boolean")
  declare snapshotMaskText?: boolean;

  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
