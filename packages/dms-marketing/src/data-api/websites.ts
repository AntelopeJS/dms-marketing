import type { RequestContext } from "@antelopejs/interface-api";
import { Controller } from "@antelopejs/interface-api";
import {
  DataController,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Listable,
  ModelReference,
  type RowFields,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  Column,
  Searchable,
  Select,
  type TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { DefaultDisplays } from "@antelopejs/interface-dms/base/table-view/column-display";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { WebsitesModel } from "@/db";
import { Website } from "@/db/tables/websites.table";
import {
  listTenantWebsites,
  requireTenantWebsite,
} from "@/services/tenant-website";
import { mergeWebsiteCards, websitesSummary } from "@/services/website-report";
import { API_BASE_PATH } from "@/types/constants";
import { HiddenStringFilter } from "./hidden-filter";
import { tenantScopedReadRoutes } from "./tenant-scope";

const COLUMN_PREFIX = "$page.marketing.websites.column.";

/** The listed rows, each with the figures of its Websites page card. */
async function withCards(
  ctx: RequestContext,
  rows: RowFields[],
): Promise<RowFields[]> {
  if (rows.length === 0) {
    return rows;
  }
  const tenantId = getRequestTenantId(ctx);
  const ids = new Set(rows.map((row) => row._id));
  const websites = (await listTenantWebsites(tenantId)).filter((website) =>
    ids.has(website._id),
  );
  return mergeWebsiteCards(rows, await websitesSummary(tenantId, websites));
}

/**
 * The list answers its rows with their cards (state, volumes, refused
 * hosts…), which the Websites page's card component draws: the cards are
 * computed, not columns, and only the listed page of rows pays for them.
 */
export function withCardRows(
  base: typeof TableViewRoutes.List,
): typeof TableViewRoutes.List {
  return {
    ...base,
    func: async function (
      this: unknown,
      ...args: Parameters<(typeof TableViewRoutes.List)["func"]>
    ) {
      const [ctx] = args;
      const answer = await base.func.call(this, ...args);
      return { ...answer, results: await withCards(ctx, answer.results) };
    },
  };
}

/** The row a deep link reads beyond the listed page, with its card too. */
export function withCardRow(
  base: typeof TableViewRoutes.Get,
): typeof TableViewRoutes.Get {
  return {
    ...base,
    func: async function (
      this: unknown,
      ...args: Parameters<(typeof TableViewRoutes.Get)["func"]>
    ) {
      const [ctx] = args;
      const row = await base.func.call(this, ...args);
      const [withCard = row] = await withCards(ctx, [row]);
      return withCard;
    },
  };
}

const scopedRoutes = tenantScopedReadRoutes(requireTenantWebsite);
const websitesRoutes = {
  ...scopedRoutes,
  get: withCardRow(scopedRoutes.get),
  list: withCardRows(scopedRoutes.list),
};

/**
 * Read-only websites source: the Websites page's table (its cards) and the
 * relation pickers (the funnels form); mutations stay on the
 * /api/marketing/websites routes. Websites are the module's one GLOBAL
 * table, so this is the one controller that scopes by column: every route
 * is tenant-forced through the wrappers above.
 */
@RegisterDataController()
@AuthOwnerOnly()
export class websitesDataAPI extends DataController(
  Website,
  websitesRoutes,
  Controller(`${API_BASE_PATH}/tables/websites`),
) {
  @ModelReference()
  @Model(WebsitesModel)
  declare model: WebsitesModel;

  @Select()
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @HiddenStringFilter()
  @Access(AccessMode.ReadOnly)
  declare tenantId: string;

  @Select()
  @Listable()
  @Searchable()
  @Sortable()
  @Column({
    name: `${COLUMN_PREFIX}name`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.IdentityDisplay({
      icon: "i-ph-globe",
      subtitleField: "domain",
    }),
    size: 260,
  })
  @Access(AccessMode.ReadOnly)
  declare name: string;

  @Select()
  @Listable()
  @Searchable()
  @Sortable()
  @Column({
    name: `${COLUMN_PREFIX}domain`,
    type: new DefaultDataTypes.StringType(),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare domain: string;

  @Listable()
  @Column({
    name: `${COLUMN_PREFIX}tracking`,
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare trackingEnabled: boolean;

  @Listable()
  @Column({
    name: `${COLUMN_PREFIX}snapshots`,
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
  })
  @Access(AccessMode.ReadOnly)
  declare snapshotsEnabled: boolean;

  @Listable()
  @Sortable()
  @Column({
    name: `${COLUMN_PREFIX}created`,
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare createdAt: Date;
}
