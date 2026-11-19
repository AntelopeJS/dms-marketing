const { describeJourneys } = require("./helpers/journeys");

describeJourneys("config", require("./journeys/config.mjs").journeys);
