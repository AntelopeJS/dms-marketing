import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import type { SnapshotColorScheme, SnapshotLayout } from "@/types";

export const pageSnapshotsTableName = "marketing_page_snapshots";

/**
 * One captured rendering per (website, path, layout) — the backdrop a
 * heatmap is drawn over, keyed by the hash of that triple. The one marketing
 * table holding page content: opt-in per website, form values masked at
 * capture, replaced when it ages, pruned on its own retention.
 */
@RegisterTable(pageSnapshotsTableName, TENANT_SCHEMA_NAME)
export class PageSnapshot extends Table {
  @Index()
  @Field("string")
  declare websiteId: string;

  @Field("string")
  declare url: string;

  @Field("string")
  declare layout: SnapshotLayout;

  /** Where the page was captured — what "open in a new tab" targets. */
  @Field("string")
  declare origin: string;

  @Field("number")
  declare viewportWidth: number;

  @Field("number")
  declare viewportHeight: number;

  @Field("number")
  declare documentWidth: number;

  @Field("number")
  declare documentHeight: number;

  @Field("string")
  declare colorScheme?: SnapshotColorScheme;

  /** Indexed on its own: the retention prune bounds on it alone. */
  @Index()
  @Field("date")
  declare capturedAt: Date;

  /** Serialized size before compression. */
  @Field("number")
  declare bytes: number;

  /** Gzipped document, base64. */
  @Field("string")
  declare html: string;
}
