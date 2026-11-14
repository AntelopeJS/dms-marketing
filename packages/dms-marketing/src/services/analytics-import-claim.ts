import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Logging } from "@antelopejs/interface-core/logging";
import { IsDuplicateKeyError } from "@antelopejs/interface-database";
import type { MarketingImportsModel } from "@/db";
import type { MarketingImport } from "@/db/tables/marketing_imports.table";

const CLAIM_RENEW_MS = 5000;
const CLAIM_POLL_MS = 1000;
/** How many reads must find the token unchanged before a takeover. */
const CLAIM_STALE_POLLS = 30;

/** The website claim, renewed in the background for as long as a replay runs. */
export interface ImportClaim {
  /** False once another instance took the claim over from this one. */
  isHeld(): boolean;
  /** Stops renewing and deletes the claim. */
  release(): Promise<void>;
}

export type ClaimAttempt =
  | { kind: "held"; claim: ImportClaim }
  | { kind: "owned"; owner: MarketingImport };

function holdClaim(
  imports: MarketingImportsModel,
  claimId: string,
  claimed: string,
): ImportClaim {
  let token: string | undefined = claimed;
  let renewal: Promise<void> = Promise.resolve();
  const renew = async () => {
    if (!token) return;
    try {
      const next = await imports.swapClaim(claimId, token);
      if (next) {
        token = next;
        return;
      }
      const stored = await imports.get(claimId);
      if (stored?.claimToken !== token) token = undefined;
    } catch (error) {
      Logging.Warn("[dms-marketing] import claim renewal failed:", error);
    }
  };
  const timer = setInterval(() => {
    renewal = renewal.then(renew);
  }, CLAIM_RENEW_MS);
  timer.unref();
  return {
    isHeld: () => token !== undefined,
    async release() {
      clearInterval(timer);
      await renewal;
      if (token) await imports.releaseClaim(claimId, token);
    },
  };
}

/**
 * Judges a claim by its token alone: a holder that stopped, wherever it stopped,
 * no longer changes it, and a slow holder still does however long its replay
 * takes. No clocks are compared between instances.
 */
async function watchClaim(
  imports: MarketingImportsModel,
  owner: MarketingImport,
): Promise<"released" | "renewed" | "stopped"> {
  for (let poll = 0; poll < CLAIM_STALE_POLLS; poll += 1) {
    await sleep(CLAIM_POLL_MS);
    const current = await imports.get(owner._id);
    if (!current) return "released";
    if (current.claimToken !== owner.claimToken) return "renewed";
  }
  return "stopped";
}

/**
 * A claim whose import finished: its holder stopped between recording the
 * import done and releasing the claim.
 */
async function ownerFinished(
  imports: MarketingImportsModel,
  owner: MarketingImport,
): Promise<boolean> {
  const row = await imports.get(`${owner.websiteId}:${owner.importId}`);
  return row?.status === "done";
}

/**
 * Claims the website for an import. A plain insert elects one writer per website
 * across instances. When another instance holds the claim for this same import,
 * waits until it either renews the claim, which answers that it is alive, or
 * stays silent long enough to take the claim over and resume.
 *
 * @param claimRow The reserved claim row, without its token
 */
export async function acquireClaim(
  imports: MarketingImportsModel,
  claimRow: Pick<
    MarketingImport,
    | "_id"
    | "websiteId"
    | "importId"
    | "status"
    | "sessions"
    | "events"
    | "dropped"
    | "startedAt"
    | "ledgered"
  >,
): Promise<ClaimAttempt> {
  const token = randomUUID();
  const held = (current: string): ClaimAttempt => ({
    kind: "held",
    claim: holdClaim(imports, claimRow._id, current),
  });
  for (;;) {
    let failure: unknown;
    try {
      await imports.insert({ ...claimRow, claimToken: token });
      return held(token);
    } catch (error) {
      failure = error;
    }
    const owner = await imports.get(claimRow._id);
    if (!owner && IsDuplicateKeyError(failure)) continue;
    if (!owner?.claimToken) throw failure;
    if (owner.claimToken === token) return held(token);
    if (await ownerFinished(imports, owner)) {
      await imports.releaseClaim(owner._id, owner.claimToken).catch(() => {});
    } else if (owner.importId !== claimRow.importId || !owner.ledgered) {
      return { kind: "owned", owner };
    } else {
      const seen = await watchClaim(imports, owner);
      if (seen === "renewed") return { kind: "owned", owner };
      if (seen === "stopped") {
        const taken = await imports.swapClaim(owner._id, owner.claimToken);
        return taken ? held(taken) : { kind: "owned", owner };
      }
    }
  }
}
