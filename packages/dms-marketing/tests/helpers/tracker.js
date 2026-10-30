const { readFileSync } = require("node:fs");
const path = require("node:path");

/** The source of `static/tracker.js`, for the suites that run it in a VM. */
const TRACKER_SOURCE = readFileSync(
  path.join(__dirname, "../../static/tracker.js"),
  "utf8",
);

/**
 * @typedef {object} BeaconEvent
 * @property {string} kind
 * @property {string} url
 * @property {Record<string, unknown>} [data]
 */

/**
 * @typedef {object} Beacon
 * @property {string} website
 * @property {BeaconEvent[]} events
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * @param {unknown} value
 * @returns {value is BeaconEvent}
 */
function isBeaconEvent(value) {
  return (
    isRecord(value) &&
    typeof value.kind === "string" &&
    typeof value.url === "string" &&
    (value.data === undefined || isRecord(value.data))
  );
}

/**
 * @param {unknown} value
 * @returns {value is Beacon}
 */
function isBeacon(value) {
  return (
    isRecord(value) &&
    typeof value.website === "string" &&
    Array.isArray(value.events) &&
    value.events.every(isBeaconEvent)
  );
}

/**
 * Reads the body the tracker handed to `sendBeacon`.
 * @param {string} body
 * @returns {Beacon}
 */
function parseBeacon(body) {
  /** @type {unknown} */
  const parsed = JSON.parse(body);
  if (!isBeacon(parsed)) {
    throw new Error("the tracker sent a malformed beacon");
  }
  return parsed;
}

module.exports = { TRACKER_SOURCE, parseBeacon };
