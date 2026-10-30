const assert = require("node:assert/strict");
const test = it;
const { z } = require("zod");
const { setConfig, applyConfigOverrides } = require("../dist/config");
const {
  applySettingsForm,
  collectionPausedNotice,
  confirmRetentionCuts,
  reloadSettings,
  settingsFormValues,
} = require("../dist/services/settings");

/**
 * @typedef {import("@antelopejs/interface-api").HTTPResult} HTTPResult
 * @typedef {import("../dist/services/settings").RetentionCutCounter} RetentionCutCounter
 * @typedef {import("../dist/services/settings").SettingsSaveGuard} SettingsSaveGuard
 * @typedef {ReturnType<typeof storedRow>} StoredRow
 */

const DAY = 86_400_000;

/** @param {StoredRow} row */
function fakeModel(row) {
  return {
    row,
    async getSingleton() {
      return this.row;
    },
    /** @param {StoredRow} next */
    async update(next) {
      this.row = { ...next };
    },
    /** @param {StoredRow} doc */
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

const issuesSchema = z.array(z.object({ path: z.array(z.string()) }));
const conflictSchema = z
  .object({
    field: z.string(),
    message: z.string(),
    params: z.object({ deleted: z.number() }),
  })
  .passthrough();

/**
 * HTTPResult serializes an object body to JSON.
 * @param {HTTPResult} error
 */
function bodyText(error) {
  return z.string().parse(error.getBody());
}

/**
 * @param {HTTPResult} error
 * @returns {string}
 */
function issueField(error) {
  return issuesSchema.parse(JSON.parse(bodyText(error)))[0].path[0];
}

/** @param {HTTPResult} error */
function conflictOf(error) {
  return conflictSchema.parse(JSON.parse(bodyText(error)));
}

test("a decimal is rounded to whole days", async () => {
  const model = fakeModel(storedRow());
  await applySettingsForm(model, { rawEventsRetentionDays: 61.6 });
  assert.equal(model.row.rawEventsRetention, 62 * DAY);
});

test("the config default itself is stored as no override", async () => {
  const model = fakeModel(storedRow());
  await applySettingsForm(model, { rawEventsRetentionDays: 90 });
  assert.equal(model.row.rawEventsRetention, null);
});

test("a coherence refusal names the field the save changed", async () => {
  const model = fakeModel(storedRow());
  await assert.rejects(
    applySettingsForm(model, { snapshotRetentionDays: 90 }),
    (error) => issueField(error) === "snapshotRetentionDays",
  );
  await assert.rejects(
    applySettingsForm(model, { rawEventsRetentionDays: 10 }),
    (error) => issueField(error) === "rawEventsRetentionDays",
  );
});

test("statistics kept shorter than raw events are refused", async () => {
  const model = fakeModel(storedRow());
  await assert.rejects(
    applySettingsForm(model, { statisticsRetentionDays: 30 }),
    (error) =>
      error.getStatus() === 400 &&
      issueField(error) === "statisticsRetentionDays",
  );
  assert.equal(model.row.statisticsRetention, 400 * DAY);
});

describe("lowering a retention that deletes data", () => {
  const counted = async () => ({ count: 1234, what: "raw_events" });
  /**
   * @param {string} actor
   * @param {RetentionCutCounter} count
   * @returns {SettingsSaveGuard}
   */
  const lower = (actor, count) => (current, next) =>
    confirmRetentionCuts(actor, current, next, count);

  test("is refused once with the count, then saved again", async () => {
    const model = fakeModel(storedRow());
    await assert.rejects(
      applySettingsForm(
        model,
        { rawEventsRetentionDays: 30 },
        lower("a", counted),
      ),
      (error) =>
        error.getStatus() === 409 &&
        conflictOf(error).field === "rawEventsRetentionDays" &&
        conflictOf(error).message.endsWith("retention_cut.raw_events") &&
        conflictOf(error).params.deleted === 1234 &&
        !("values" in conflictOf(error)),
    );
    assert.equal(model.row.rawEventsRetention, 60 * DAY);
    await applySettingsForm(
      model,
      { rawEventsRetentionDays: 30 },
      lower("a", counted),
    );
    assert.equal(model.row.rawEventsRetention, 30 * DAY);
  });

  test("is not confirmed by another owner's warning", async () => {
    const model = fakeModel(storedRow());
    await assert.rejects(
      applySettingsForm(
        model,
        { rawEventsRetentionDays: 31 },
        lower("b", counted),
      ),
    );
    await assert.rejects(
      applySettingsForm(
        model,
        { rawEventsRetentionDays: 31 },
        lower("c", counted),
      ),
    );
  });

  test("saves at once when nothing that old exists", async () => {
    const model = fakeModel(storedRow());
    const none = async () => ({ count: 0, what: "raw_events" });
    await applySettingsForm(
      model,
      { rawEventsRetentionDays: 32 },
      lower("d", none),
    );
    assert.equal(model.row.rawEventsRetention, 32 * DAY);
  });

  test("never asks on a raise", async () => {
    const model = fakeModel(storedRow());
    const unexpected = async () => assert.fail("raise counted");
    await applySettingsForm(
      model,
      { rawEventsRetentionDays: 120 },
      lower("e", unexpected),
    );
    assert.equal(model.row.rawEventsRetention, 120 * DAY);
  });
});

test("a reload puts another instance's save in force", async () => {
  const model = fakeModel(storedRow());
  await reloadSettings(model);
  assert.equal(settingsFormValues().heatmapSamplePercent, 25);
  model.row = { ...model.row, heatmapSampleRate: 0.4 };
  await reloadSettings(model);
  assert.equal(settingsFormValues().heatmapSamplePercent, 40);
});

describe("the collection paused notice", () => {
  afterEach(() => applyConfigOverrides({}));

  test("is null while the module collects", () => {
    applyConfigOverrides({ trackerEnabled: true });
    assert.equal(collectionPausedNotice(), null);
  });

  test("warns and links to Settings while collection is paused", () => {
    applyConfigOverrides({ trackerEnabled: false });
    const notice = collectionPausedNotice();
    assert.equal(notice.tone, "warning");
    assert.equal(notice.icon, "i-ph-pause-circle");
    assert.equal(
      notice.title,
      "$page.marketing.websites.collection_paused.title",
    );
    assert.deepEqual(notice.actions, [
      {
        label: "$page.marketing.websites.collection_paused.open",
        to: "/modules/marketing/settings",
        variant: "outline",
        color: "neutral",
      },
    ]);
  });
});

const serializedFormSchema = z.object({
  fields: z.array(
    z.object({
      component: z.object({
        options: z.object({
          clamp: z.boolean(),
          min: z.number(),
          max: z.number(),
        }),
      }),
    }),
  ),
});

describe("the settings form", () => {
  test("keeps a number typed out of bounds and says so under the field", () => {
    const { retentionForm } = require("../dist/pages/settings/form");
    const { fields } = serializedFormSchema.parse(
      retentionForm.serializeSync().options,
    );
    assert.equal(fields.length, 3);
    for (const field of fields) {
      const options = field.component.options;
      assert.equal(options.clamp, false);
      assert.ok(Number.isFinite(options.min));
      assert.ok(Number.isFinite(options.max));
    }
  });
});
