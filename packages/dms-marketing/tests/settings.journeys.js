const { describeJourneys } = require("./helpers/journeys");

describeJourneys("settings", require("./journeys/settings.mjs").journeys);
