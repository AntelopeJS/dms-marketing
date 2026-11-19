const { describeJourneys } = require("./helpers/journeys");

describeJourneys("smoke", require("./journeys/smoke.mjs").journeys);
