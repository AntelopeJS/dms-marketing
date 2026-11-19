const { describeJourneys } = require("./helpers/journeys");

describeJourneys("abtests", require("./journeys/abtests.mjs").journeys);
