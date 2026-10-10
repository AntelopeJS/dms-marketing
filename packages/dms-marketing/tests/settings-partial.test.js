const assert = require("node:assert/strict");
const test = it;
const { setConfig } = require("../dist/config");
const { applySettingsForm } = require("../dist/services/settings");

const DAY = 86_400_000;

function fakeModel(row) {
  return {
    row,
    async getSingleton() {
      return this.row;
    },
    async update(next) {
      this.row = { ...next };
    },
    async insertSingleton(doc) {
      this.row = doc;
      return doc;
    },
  };
}

function storedRow() {
  return {
    _id: "settings",
    trackerEnabled: true,
    rawEventsRetention: 60 * DAY,
    statisticsRetention: 400 * DAY,
    heatmapSampleRate: 0.25,
    snapshotRetention: 20 * DAY,
    visitorHashSecret: "secret",
  };
}

beforeEach(() => setConfig({}));

test("a partial body keeps every setting it does not carry", async () => {
  const model = fakeModel(storedRow());
  await applySettingsForm(model, { heatmapSamplePercent: 50 });
  assert.equal(model.row.heatmapSampleRate, 0.5);
  assert.equal(model.row.rawEventsRetention, 60 * DAY);
  assert.equal(model.row.statisticsRetention, 400 * DAY);
  assert.equal(model.row.snapshotRetention, 20 * DAY);
  assert.equal(model.row.trackerEnabled, true);
});

test("null clears an override back to the config default", async () => {
  const model = fakeModel(storedRow());
  await applySettingsForm(model, { statisticsRetentionDays: null });
  assert.equal(model.row.statisticsRetention, null);
  assert.equal(model.row.rawEventsRetention, 60 * DAY);
});

test("the master switch alone flips collection", async () => {
  const model = fakeModel(storedRow());
  await applySettingsForm(model, { trackerEnabled: false });
  assert.equal(model.row.trackerEnabled, false);
  assert.equal(model.row.heatmapSampleRate, 0.25);
});

test("snapshots kept longer than raw events are refused, not clamped", async () => {
  const model = fakeModel(storedRow());
  await assert.rejects(
    applySettingsForm(model, { snapshotRetentionDays: 90 }),
    (error) => error.getStatus() === 400,
  );
  assert.equal(model.row.snapshotRetention, 20 * DAY);
});
