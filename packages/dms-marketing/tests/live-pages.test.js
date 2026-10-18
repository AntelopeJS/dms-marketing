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

/** Every component under the page's context bar, with its id path. */
function blocksOf(Page) {
  const found = [];
  const walk = (info, path) => {
    found.push({ path, name: info.componentName, options: info.options ?? {} });
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

/** A block reading a route: a fetch URL, or a source table's own. */
const readsData = (block) => !!(block.options.fetchUrl || block.options.source);

test("every analytics page under the context bar is live, through the DMS gate", () => {
  for (const [id, Page] of Object.entries(LIVE_PAGES)) {
    const { pageInfo } = GetMetadata(Page, PageMetadata);
    const live = pageInfo.live ?? pageInfo.menuOptions?.live;
    assert.deepEqual(live, CONTEXT_PAGE_LIVE, id);
  }
  assert.equal(CONTEXT_PAGE_LIVE.rememberKey, "marketing");
  assert.ok(CONTEXT_PAGE_LIVE.maxRate > 0);
});

test("the context bar hears the arrivals on every live page", () => {
  for (const [id, Page] of Object.entries(LIVE_PAGES)) {
    const [bar] = blocksOf(Page);
    assert.equal(bar.name, "DmsMarketingContext", id);
    assert.equal(bar.options.realtimeTopic, MARKETING_EVENTS_TOPIC, id);
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
  // Banners, charts, the quality strip, top lists and both tables.
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

test("the KPI cards, which take no topic, are read by the bar on arrivals", () => {
  const blocks = blocksOf(MarketingOverviewPage);
  assert.ok(blocks.some((block) => block.name === KPI_CARD));
  assert.equal(blocks[0].options.refreshBlocksOnEvents, true);
  for (const Page of [
    MarketingAcquisitionPage,
    MarketingPagesPage,
    MarketingFunnelsPage,
    MarketingFunnelPage,
  ]) {
    const bar = blocksOf(Page)[0];
    assert.notEqual(bar.options.refreshBlocksOnEvents, true);
    assert.ok(!blocksOf(Page).some((block) => block.name === KPI_CARD));
  }
});

test("only Pages & heatmaps leaves the website picker out of the bar", () => {
  for (const [id, Page] of Object.entries(LIVE_PAGES)) {
    const bar = blocksOf(Page)[0];
    if (id === "pages") {
      assert.equal(bar.options.websitePicker, false, id);
    } else {
      assert.notEqual(bar.options.websitePicker, false, id);
    }
  }
});

test("arrivals are published batched, with their count and nothing else", async () => {
  // What another suite's beacons left waiting is not this batch.
  stopCollectedNotices();
  const received = [];
  const unsubscribe = SubscribeMessage(MARKETING_EVENTS_TOPIC, (message) =>
    received.push(message),
  );
  try {
    noteCollected(3);
    noteCollected(0);
    noteCollected(2);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(received.length, 1);
    assert.equal(received[0].type, "collected");
    assert.deepEqual(received[0].payload, { count: 5 });
  } finally {
    unsubscribe();
    stopCollectedNotices();
  }
});

test("a stop drops what was waiting to be published", async () => {
  const received = [];
  const unsubscribe = SubscribeMessage(MARKETING_EVENTS_TOPIC, (message) =>
    received.push(message),
  );
  try {
    noteCollected(4);
    stopCollectedNotices();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(received.length, 0);
  } finally {
    unsubscribe();
  }
});
