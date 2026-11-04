const assert = require("node:assert/strict");
const test = it;
const { GetMetadata } = require("@antelopejs/interface-core");
const { PageMetadata } = require("@antelopejs/interface-dms/page");
const { SubscribeMessage } = require("@antelopejs/interface-dms/realtime");
const { CONTEXT_PAGE_LIVE } = require("../dist/pages/blocks");
const { MarketingOverviewPage } = require("../dist/pages/overview/page");
const { MarketingAcquisitionPage } = require("../dist/pages/acquisition/page");
const { MarketingPagesPage } = require("../dist/pages/pages/page");
const { MarketingFunnelsPage } = require("../dist/pages/funnels/page");
const { MarketingFunnelPage } = require("../dist/pages/funnel/page");
const {
  MARKETING_EVENTS_TOPIC,
  noteCollected,
  stopCollectedNotices,
} = require("../dist/services/realtime");

const LIVE_PAGES = {
  overview: MarketingOverviewPage,
  acquisition: MarketingAcquisitionPage,
  pages: MarketingPagesPage,
  funnels: MarketingFunnelsPage,
  funnel: MarketingFunnelPage,
};

/** @typedef {import("@antelopejs/interface-dms/page").PageInfo} PageInfo */
/** @typedef {import("@antelopejs/interface-dms/realtime").RealtimeMessage} RealtimeMessage */
/** @typedef {(typeof LIVE_PAGES)[keyof typeof LIVE_PAGES]} LivePage */
/** @typedef {NonNullable<ReturnType<LivePage["content"]["serializeSync"]>["children"]>[number]["component"]} SerializedBlock */
/**
 * @typedef {object} Block
 * @property {string} path
 * @property {string} name
 * @property {Record<string, unknown>} options
 */

/**
 * @param {unknown} options
 * @returns {options is Record<string, unknown>}
 */
const isOptions = (options) => options instanceof Object;

/**
 * The Direct / Pause valve of a page: its own, or an older DMS's `menuOptions`.
 * @param {PageInfo & { menuOptions?: Pick<PageInfo, "live"> }} pageInfo
 */
const liveOf = (pageInfo) => pageInfo.live ?? pageInfo.menuOptions?.live;

/**
 * Every component under the page's context gate, with its id path.
 * @param {LivePage} Page
 */
function blocksOf(Page) {
  /** @type {Block[]} */
  const found = [];
  /**
   * @param {SerializedBlock} info
   * @param {string} path
   */
  const walk = (info, path) => {
    found.push({
      path,
      name: info.componentName,
      options: isOptions(info.options) ? info.options : {},
    });
    for (const child of info.children ?? []) {
      walk(child.component, `${path}/${child.id}`);
    }
  };
  walk(Page.content.serializeSync(), "content");
  return found;
}

/** Stock blocks that read a route and take a `realtimeTopic`. */
const TOPIC_BLOCKS = new Set([
  "dms-banner-block",
  "dms-chart-card",
  "dms-stat-group-block",
  "dms-table-view",
  "dms-top-list-card",
]);
const KPI_CARD = "dms-kpi-card";
const TABLE_VIEW = "dms-table-view";

/**
 * A block reading a route: a fetch URL, or a source table's own.
 * @param {Block} block
 */
const readsData = (block) => !!(block.options.fetchUrl || block.options.source);

test("every analytics page under the context bar is live, through the DMS gate", () => {
  for (const [id, Page] of Object.entries(LIVE_PAGES)) {
    const { pageInfo } = GetMetadata(Page, PageMetadata);
    const live = liveOf(pageInfo);
    assert.deepEqual(live, CONTEXT_PAGE_LIVE, id);
  }
  assert.equal(CONTEXT_PAGE_LIVE.rememberKey, "marketing");
  assert.ok(CONTEXT_PAGE_LIVE.maxRate > 0);
});

test("every live page opens on the module's toolbar, the website picker first", () => {
  for (const [id, Page] of Object.entries(LIVE_PAGES)) {
    const toolbar = Page.toolbar.serializeSync();
    assert.equal(toolbar.componentName, "dms-page-toolbar-block", id);
    assert.deepEqual(
      toolbar.children.map((child) => child.id),
      ["website", "live", "period"],
      id,
    );
    const [picker, , period] = toolbar.children.map((child) => child.component);
    assert.equal(picker.componentName, "DmsMarketingWebsitePicker", id);
    assert.equal(picker.options.realtimeTopic, MARKETING_EVENTS_TOPIC, id);
    assert.equal(period.options.id, "marketing", id);
    const [gate] = blocksOf(Page);
    assert.equal(gate.name, "DmsMarketingContext", id);
  }
});

test("each stock block reading data follows the arrivals topic", () => {
  let checked = 0;
  for (const [id, Page] of Object.entries(LIVE_PAGES)) {
    for (const block of blocksOf(Page)) {
      if (!TOPIC_BLOCKS.has(block.name) || !readsData(block)) {
        continue;
      }
      checked += 1;
      assert.equal(
        block.options.realtimeTopic,
        MARKETING_EVENTS_TOPIC,
        `${id}: ${block.path}`,
      );
    }
  }
  assert.ok(checked >= 13, `${checked} blocks checked`);
});

test("a paused table keeps its rows and counts the events that came in", () => {
  const tables = Object.values(LIVE_PAGES)
    .flatMap(blocksOf)
    .filter((block) => block.name === TABLE_VIEW);
  assert.ok(tables.length >= 2);
  for (const table of tables) {
    assert.deepEqual(table.options.liveHold, {
      missedLabel: "$page.marketing.live.new_events",
    });
  }
});

test("the KPI cards follow the arrivals topic themselves", () => {
  const cards = blocksOf(MarketingOverviewPage).filter(
    (block) => block.name === KPI_CARD,
  );
  assert.ok(cards.length > 0);
  for (const card of cards) {
    assert.equal(card.options.realtimeTopic, MARKETING_EVENTS_TOPIC, card.path);
  }
});

test("arrivals are published batched per tenant, with their count and nothing else", async () => {
  stopCollectedNotices();
  /** @type {RealtimeMessage[]} */
  const received = [];
  const unsubscribe = SubscribeMessage(MARKETING_EVENTS_TOPIC, (message) =>
    received.push(message),
  );
  try {
    noteCollected("tenant-a", 3);
    noteCollected("tenant-b", 1);
    noteCollected("tenant-a", 0);
    noteCollected("tenant-a", 2);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(received.length, 2);
    assert.ok(received.every((message) => message.type === "collected"));
    assert.deepEqual(
      received.map((message) => message.payload.count).sort((a, b) => a - b),
      [1, 5],
    );
  } finally {
    unsubscribe();
    stopCollectedNotices();
  }
});

test("a stop drops what was waiting to be published", async () => {
  /** @type {RealtimeMessage[]} */
  const received = [];
  const unsubscribe = SubscribeMessage(MARKETING_EVENTS_TOPIC, (message) =>
    received.push(message),
  );
  try {
    noteCollected("tenant-a", 4);
    stopCollectedNotices();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(received.length, 0);
  } finally {
    unsubscribe();
  }
});
