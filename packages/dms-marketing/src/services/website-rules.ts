import { GetModel } from "@antelopejs/interface-database-decorators";
import { z } from "zod";
import { WebsitesModel } from "@/db";
import type { Website } from "@/db/tables/websites.table";
import {
  MAX_DOMAIN_LENGTH,
  MAX_EXTRA_DOMAINS,
  MAX_NAME_LENGTH,
} from "@/types/constants";
import { isDashboardWebsite } from "./dashboard-tracking";
import {
  findHostConflict,
  type HostConflict,
  isValidHostname,
  normalizeHostname,
} from "./website-hosts";

const INVALID_HOSTNAME_MESSAGE = "$page.marketing.errors.invalid_hostname";

/**
 * The field rules of a website, shared by the dashboard routes and the
 * declarations of the interface: a site declared from code is held to what
 * the owner could have typed.
 */

/** What the owner types, stored as the bare lowercase hostname. */
export const hostnameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_DOMAIN_LENGTH)
  .transform(normalizeHostname)
  .refine(isValidHostname, { message: INVALID_HOSTNAME_MESSAGE });

export const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);

export const extraDomainsSchema = z
  .array(hostnameSchema)
  .max(MAX_EXTRA_DOMAINS);

/** Duplicates and the domain itself add nothing to the extra hosts. */
export function distinctExtraHosts(domain: string, hosts: string[]): string[] {
  return [...new Set(hosts)].filter((host) => host !== domain);
}

/**
 * The first host of `website` another site of its tenant already declares.
 * The dashboard's own site is left out both ways: it shares its host with
 * whatever else answers there (a site in development on localhost), and its
 * tag is the module's, so no traffic is split.
 */
export async function tenantHostConflict(
  website: Website,
): Promise<HostConflict | undefined> {
  if (isDashboardWebsite(website)) {
    return undefined;
  }
  const websites = await GetModel(WebsitesModel).getByTenant(website.tenantId);
  return findHostConflict(
    website,
    websites.filter((site) => !isDashboardWebsite(site)),
  );
}
