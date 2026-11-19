const { describeJourneys } = require("./helpers/journeys");

describeJourneys("snapshots", require("./journeys/snapshots.mjs").journeys);
