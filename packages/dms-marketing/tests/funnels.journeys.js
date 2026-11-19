const { describeJourneys } = require("./helpers/journeys");

describeJourneys("funnels", require("./journeys/funnels.mjs").journeys);
