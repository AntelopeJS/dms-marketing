const { describeJourneys } = require("./helpers/journeys");

describeJourneys("content", require("./journeys/content.mjs").journeys);
