const { describeJourneys } = require("./helpers/journeys");

describeJourneys("pages", require("./journeys/pages.mjs").journeys);
