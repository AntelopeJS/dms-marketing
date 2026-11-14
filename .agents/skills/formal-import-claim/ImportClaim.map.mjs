/**
 * Reader's view of ImportClaim.tla for /statechart: one region for the claim
 * row, one for the import row, one for the website's imported history and one
 * per ImportAnalytics call.
 */

/**
 * The variables of ImportClaim.tla this view reads, as /statechart passes
 * them: a function of calls is an object keyed by call name, a sequence an
 * object keyed from 1, a set an array.
 * @typedef {object} Vars
 * @property {string} claim
 * @property {string} row
 * @property {Record<string, number>} ledger
 * @property {Record<string, string[]>} raw
 * @property {Record<string, string>} pc
 * @property {Record<string, boolean>} holds
 * @property {Record<string, string>} answer
 */

/** @param {Vars} v */
function claimRow(v) {
  return v.claim === "none" ? "No claim row" : `Claim row holds ${v.claim}'s token`;
}

/** @param {Vars} v */
function importRow(v) {
  return v.row === "none" ? "No import row" : `Import row ${v.row}`;
}

/** @param {Vars} v */
function history(v) {
  const days = Object.keys(v.ledger).map((day) => ({
    commits: v.ledger[day] ?? 0,
    writers: (v.raw[day] ?? []).length,
  }));
  if (days.some((day) => day.commits > 1)) return "A day counted twice";
  if (days.some((day) => day.commits > 0 && day.writers > 1)) return "A counted day stored twice";
  if (days.some((day) => day.commits > 0 && day.writers === 0)) return "A counted day lost its raw rows";
  if (days.every((day) => day.commits === 1)) return "Every day counted once";
  if (days.some((day) => day.commits > 0)) return "Some days counted";
  if (days.some((day) => day.writers > 0)) return "Raw rows written, nothing counted";
  return "Nothing written";
}

const PHASES = new Map([
  ["idle", "Not started"],
  ["insert", "Waiting for the claim"],
  ["readOwner", "Waiting for the claim"],
  ["ownerFinished", "Waiting for the claim"],
  ["releaseOwner", "Releasing a finished holder's claim"],
  ["watch", "Waiting for the claim"],
  ["takeover", "Waiting for the claim"],
  ["current", "Preparing the replay"],
  ["writeRow", "Preparing the replay"],
  ["readBack", "Preparing the replay"],
  ["ledger", "Preparing the replay"],
  ["discard", "Deleting uncounted rows"],
  ["check", "Replaying"],
  ["write", "Replaying"],
  ["commit", "Replaying"],
  ["markDone", "Finishing"],
  ["release", "Finishing"],
  ["markFailed", "Failing"],
  ["releaseFailed", "Failing"],
  ["releaseSkip", "Finishing"],
  ["releaseFound", "Finishing"],
  ["releaseErr", "Failing"],
  ["crashed", "Process died"],
]);

/**
 * @param {Vars} v
 * @param {string} call
 */
function callPhase(v, call) {
  const pc = v.pc[call] ?? "idle";
  if (pc === "end") return `Returned ${v.answer[call]}`;
  const phase = PHASES.get(pc) ?? pc;
  const lost = ["check", "write", "commit", "discard", "markDone", "release"].includes(pc) && !v.holds[call];
  return lost ? `${phase}, claim lost` : phase;
}

/**
 * One region each for the claim row, the import row and the history, and
 * one per call.
 * @param {Vars} v
 * @returns {Record<string, string>}
 */
export function state(v) {
  /** @type {Record<string, string>} */
  const regions = { Claim: claimRow(v), Import: importRow(v), History: history(v) };
  for (const call of Object.keys(v.pc)) regions[`Call ${call}`] = callPhase(v, call);
  return regions;
}

const STEPS = new Map([
  ["Begin", "a call reads its import row"],
  ["InsertClaim", "the call inserts the claim row"],
  ["ReadOwner", "the call reads the claim row"],
  ["OwnerFinished", "the call reads the holder's import row"],
  ["ReleaseOwner", "the call deletes a finished holder's claim"],
  ["Poll", "the watcher sees the token change or the row go"],
  ["GiveUp", "30 polls see the same token"],
  ["TakeOver", "the watcher swaps the holder's token"],
  ["Renew", "the holder's renewal runs"],
  ["ReadCurrent", "the holder reads its import row"],
  ["ReleaseSkip", "the holder releases and answers skipped"],
  ["WriteRow", "the holder inserts its import row or sets it running"],
  ["ReadBack", "the holder reads back the import row another call wrote"],
  ["ReleaseFound", "the holder releases and answers the row it read back"],
  ["ReleaseErr", "the holder releases and rejects"],
  ["ReadLedger", "the holder reads the ledger"],
  ["Discard", "the holder deletes the rows of uncounted days"],
  ["Check", "the holder checks it still holds the claim"],
  ["WriteRaw", "the holder stores a day's events and sessions"],
  ["Commit", "the holder commits the day's counters and ledger entry"],
  ["StorageFails", "a write fails in storage"],
  ["MarkDone", "the holder marks the import done while the row has its fence"],
  ["Release", "the holder releases the claim"],
  ["MarkFailed", "the call marks the import failed"],
  ["ReleaseFailed", "the call releases and rejects"],
  ["Crash", "the call's process dies"],
]);

/**
 * The arrow label of one TLC step; `Settled` changes nothing and is hidden.
 * @param {string} action
 */
export function step(action) {
  return action === "Settled" ? null : (STEPS.get(action) ?? null);
}

export const title = "ImportAnalytics website claim and replay of dms-marketing";
