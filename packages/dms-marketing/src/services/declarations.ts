import { z } from "zod";
import { DECLARED_ID_PATTERN } from "@/types/constants";
import { isNumber, isString } from "@/utils/guards";

/**
 * What the content declarations of the interface (EnsureWebsite,
 * EnsureFunnel, ImportAnalytics) share: the caller's ids, the tenant
 * validation and the error shape.
 */

/** Thrown on a declaration or import the module refuses. */
export class MarketingDeclarationError extends Error {
  constructor(operation: string, id: string, reason: string) {
    super(`[dms-marketing] ${operation}("${id}"): ${reason}`);
    this.name = "MarketingDeclarationError";
  }
}

export const declaredIdSchema = z.string().regex(DECLARED_ID_PATTERN);

/** The caller's id, or a clear refusal naming the operation. */
export function requireDeclaredId(
  operation: string,
  value: string | undefined,
): string {
  const parsed = declaredIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new MarketingDeclarationError(
      operation,
      String(value),
      "the id must be 1-64 letters, digits, '-' or '_', starting with a letter or a digit",
    );
  }
  return parsed.data;
}

export function declaredTenant(
  operation: string,
  id: string,
  tenantId: string | undefined,
): string {
  if (
    !isString(tenantId) ||
    tenantId.trim() === "" ||
    tenantId !== tenantId.trim()
  ) {
    throw new MarketingDeclarationError(
      operation,
      id,
      "tenantId: an explicit nonempty tenant id without surrounding whitespace is required",
    );
  }
  return tenantId;
}

/** Epoch ms from epoch ms or an ISO 8601 string; undefined when unusable. */
export function instantOf(value: unknown): number | undefined {
  const ms = isNumber(value)
    ? value
    : isString(value)
      ? Date.parse(value)
      : Number.NaN;
  return Number.isFinite(ms) ? ms : undefined;
}

/** The dashboard's translation keys a shared rule may carry, in plain words. */
const READABLE_MESSAGES: Record<string, string> = {
  "$page.marketing.errors.invalid_hostname":
    "not a hostname, an IP address or localhost",
};

/** The first issue of a zod failure, as one readable line. */
export function describeIssue(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const message = READABLE_MESSAGES[issue?.message ?? ""] ?? issue?.message;
    const path = issue?.path.join(".");
    return path ? `${path}: ${message}` : (message ?? "invalid");
  }
  return error instanceof Error ? error.message : String(error);
}
