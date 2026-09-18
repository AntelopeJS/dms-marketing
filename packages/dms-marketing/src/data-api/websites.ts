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
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { Column, Searchable, Select } from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { WebsitesModel } from "@/db";
import { Website } from "@/db/tables/websites.table";
import { requireTenantWebsite } from "@/services/tenant-website";
import { API_BASE_PATH } from "@/types/constants";
import { HiddenStringFilter } from "./hidden-filter";
import { tenantScopedReadRoutes } from "./tenant-scope";

const websitesRoutes = tenantScopedReadRoutes(requireTenantWebsite);

/**
 * Read-only websites source for relation pickers (the funnels form);
 * mutations stay on the /api/marketing/websites routes. Websites are the
 * module's one GLOBAL table, so this is the one controller that scopes by
 * column: every route is tenant-forced through the wrappers above.
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
    name: "$page.marketing.websites.column.name",
    type: new DefaultDataTypes.StringType(),
  })
  @Access(AccessMode.ReadOnly)
  declare name: string;

  @Select()
  @Listable()
  @Searchable()
  @Column({
    name: "$page.marketing.websites.column.domain",
    type: new DefaultDataTypes.StringType(),
  })
  @Access(AccessMode.ReadOnly)
  declare domain: string;
}
