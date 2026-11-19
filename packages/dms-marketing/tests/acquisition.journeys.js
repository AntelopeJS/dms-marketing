const { describeJourneys } = require("./helpers/journeys");

describeJourneys("acquisition", require("./journeys/acquisition.mjs").journeys);
