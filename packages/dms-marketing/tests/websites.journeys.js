const { describeJourneys } = require("./helpers/journeys");

describeJourneys("websites", require("./journeys/websites.mjs").journeys);
