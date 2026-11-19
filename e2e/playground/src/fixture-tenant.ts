import { Controller, JSONBody, Post } from "@antelopejs/interface-api";
import {
  GetRegisteredHooks,
  Hook,
  type TenantExportArchive,
} from "@antelopejs/interface-dms/hooks";
import { z } from "zod";

const tenantSchema = z.object({ tenantId: z.string() });

type ArchiveEntry = { path: string; data: Parameters<TenantExportArchive["addJson"]>[1] };

/** An archive that keeps the JSON entries a contributor adds and refuses files and streams. */
function memoryArchive(entries: ArchiveEntry[]): TenantExportArchive {
  return {
    addJson(path, data) {
      entries.push({ path, data });
      return Promise.resolve();
    },
    addFile(path) {
      return Promise.reject(new Error(`file entry ${path}`));
    },
    addStream(path) {
      return Promise.reject(new Error(`stream entry ${path}`));
    },
  };
}

/**
 * The tenant lifecycle hooks as the DMS core fires them: the workspace export
 * calls every `TENANT_DATA_EXPORT` contributor, the workspace deletion every
 * `TENANT_DELETED` handler. Only the verification playground serves them,
 * because the DMS core of a run has no route that exports or deletes a tenant.
 */
export class VerifyTenantHooksController extends Controller("/verify-marketing/tenant") {
  @Post("/export")
  async export(@JSONBody() body: unknown) {
    const { tenantId } = tenantSchema.parse(body);
    const contributions = [];
    for (const contributor of GetRegisteredHooks(Hook.TENANT_DATA_EXPORT)) {
      const entries: ArchiveEntry[] = [];
      const contribution = await contributor.handler(tenantId, memoryArchive(entries), new AbortController().signal);
      contributions.push({ registeredBy: contributor.moduleId, contribution, entries });
    }
    return { contributions };
  }

  @Post("/delete")
  async delete(@JSONBody() body: unknown) {
    const { tenantId } = tenantSchema.parse(body);
    const handlers = GetRegisteredHooks(Hook.TENANT_DELETED).filter((hook) => hook.moduleId?.includes("marketing") === true && !hook.moduleId.includes("verify"));
    for (const hook of handlers) await hook.handler(tenantId);
    return { ran: handlers.map((hook) => hook.moduleId) };
  }
}
