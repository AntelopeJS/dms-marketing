const { describeJourneys } = require("./helpers/journeys");

describeJourneys("collect", require("./journeys/collect.mjs").journeys);
