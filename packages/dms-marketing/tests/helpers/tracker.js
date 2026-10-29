const { readFileSync } = require("node:fs");
const path = require("node:path");

/** The source of `static/tracker.js`, for the suites that run it in a VM. */
const TRACKER_SOURCE = readFileSync(
  path.join(__dirname, "../../static/tracker.js"),
  "utf8",
);

module.exports = { TRACKER_SOURCE };
