const { describeJourneys } = require("./helpers/journeys");

describeJourneys("access", require("./journeys/access.mjs").journeys);
