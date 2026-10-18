const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = it;

// --- The tracker on an app shell scrolling an inner panel ------------------

const TRACKER_SOURCE = readFileSync(
  path.join(__dirname, "../static/tracker.js"),
  "utf8",
);
const ORIGIN = "https://dms.example.com";
const WIDTH = 1440;
const HEIGHT = 900;

class Element {
  constructor(name, parent, geometry = {}) {
    this.localName = name;
    this.parentElement = parent;
    this.id = "";
    this.classList = [];
    this.attributes = new Set();
    this.isConnected = true;
    this.overflowY = "visible";
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.box = { top: 0, left: 0, right: WIDTH, bottom: HEIGHT };
    Object.assign(this, geometry);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  getBoundingClientRect() {
    const { top, left, right, bottom } = this.box;
    return {
      top,
      left,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  }
}

/**
 * The dashboard's shape: a document exactly as tall as the window, a header
 * above a panel whose body scrolls (2580 px of content in 809), and a small
 * scrolling list beside it. `under` is what elementFromPoint finds.
 */
function shell() {
  const html = new Element("html", null, {
    scrollHeight: 899,
    clientHeight: 900,
  });
  html.scrollWidth = WIDTH;
  const body = new Element("body", html);
  const app = new Element("div", body);
  const panel = new Element("div", app, {
    overflowY: "auto",
    scrollHeight: 2580,
    clientHeight: 809,
    box: { top: 91, left: 240, right: WIDTH, bottom: HEIGHT },
  });
  const list = new Element("ul", panel, {
    overflowY: "auto",
    scrollHeight: 600,
    clientHeight: 200,
    box: { top: 300, left: 600, right: 900, bottom: 500 },
  });
  const button = new Element("button", panel, {
    box: { top: 480, left: 300, right: 400, bottom: 520 },
  });
  return { html, body, app, panel, list, under: list, button };
}

function loadTracker(page) {
  const attrs = new Map(
    Object.entries({ "data-website-id": "site", "data-heatmap-sample": "1" }),
  );
  const windowListeners = new Map();
  const documentListeners = new Map();
  const beacons = [];
  const all = Object.values(page).filter((node) => node instanceof Element);
  const on = (listeners) => (type, listener) =>
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  const context = {
    console,
    URL,
    Element,
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    setTimeout: () => 0,
    clearTimeout: () => {},
    location: { origin: ORIGIN, pathname: "/dashboard", search: "" },
    history: { pushState() {}, replaceState() {} },
    screen: { width: WIDTH, height: HEIGHT },
    innerWidth: WIDTH,
    innerHeight: HEIGHT,
    scrollX: 0,
    scrollY: 0,
    navigator: {
      language: "en-GB",
      sendBeacon(_url, blob) {
        beacons.push(JSON.parse(blob.body));
        return true;
      },
    },
    getComputedStyle: (element) => ({ overflowY: element.overflowY }),
    document: {
      currentScript: {
        src: `${ORIGIN}/api/marketing/tracker.js`,
        getAttribute: (name) => attrs.get(name) ?? null,
      },
      documentElement: page.html,
      body: page.body,
      referrer: "",
      title: "Dashboard",
      readyState: "loading",
      visibilityState: "visible",
      addEventListener: on(documentListeners),
      elementFromPoint: () => page.under,
      querySelector: (selector) => {
        const name = selector.slice(1, -1);
        return all.find((node) => node.hasAttribute(name)) ?? null;
      },
      querySelectorAll: () => [page.button],
    },
    Blob: class {
      constructor(parts) {
        this.body = parts.join("");
      }
    },
    addEventListener: on(windowListeners),
  };
  context.window = context;
  vm.runInNewContext(TRACKER_SOURCE, context);
  const fire = (listeners, type, event) => {
    for (const listener of listeners.get(type) ?? []) {
      listener(event);
    }
  };
  return {
    scroll: (target) => fire(documentListeners, "scroll", { target }),
    click: (target, clientX, clientY) =>
      fire(documentListeners, "click", {
        isTrusted: true,
        target,
        detail: 1,
        clientX,
        clientY,
        pageX: clientX,
        pageY: clientY,
      }),
    /** Everything sent so far, flushed as on leaving the page. */
    sent(kind) {
      fire(windowListeners, "pagehide");
      return beacons
        .flatMap((beacon) => beacon.events)
        .filter((event) => event.kind === kind)
        .map((event) => event.data);
    },
  };
}

test("scroll depth is measured on the panel that scrolls the page", () => {
  const page = shell();
  const tracker = loadTracker(page);
  page.panel.scrollTop = (2580 - 809) / 2;
  // The list scrolling bubbles nowhere: only a capture listener hears it,
  // and the depth read is still the panel's.
  tracker.scroll(page.list);
  assert.deepEqual(tracker.sent("scroll"), [{ depth: 50 }]);
});

test("a click's document fraction is taken in the unrolled content", () => {
  const page = shell();
  const tracker = loadTracker(page);
  page.panel.scrollTop = 1000;
  tracker.click(page.button, 350, 500);
  const [click] = tracker.sent("click");
  // 500 px down the window, 1000 px into the panel, out of 899 + 1771.
  assert.equal(click.dy, Number((1500 / 2670).toFixed(4)));
  assert.equal(click.y, Number((500 / HEIGHT).toFixed(4)));
  assert.equal(click.selector, "div>div>button");
});

test("a header click above the panel is not shifted by its scroll", () => {
  const page = shell();
  const tracker = loadTracker(page);
  page.panel.scrollTop = 1000;
  tracker.click(page.app, 350, 40);
  assert.equal(tracker.sent("click")[0].dy, Number((40 / 2670).toFixed(4)));
});

test("the marked element wins over the largest one", () => {
  const page = shell();
  page.list.attributes.add("data-marketing-scroll-root");
  const tracker = loadTracker(page);
  page.list.scrollTop = 400;
  page.panel.scrollTop = 0;
  tracker.scroll(page.list);
  assert.deepEqual(tracker.sent("scroll"), [{ depth: 100 }]);
});

test("a small scroller alone is no scroll root: the document stands", () => {
  const page = shell();
  page.panel.overflowY = "hidden";
  const tracker = loadTracker(page);
  page.list.scrollTop = 400;
  tracker.scroll(page.list);
  // The document does not scroll: all of it shows.
  assert.deepEqual(tracker.sent("scroll"), [{ depth: 100 }]);
});

test("a document that scrolls keeps being the scroll root", () => {
  const page = shell();
  page.html.scrollHeight = 1900;
  const tracker = loadTracker(page);
  page.html.scrollTop = 500;
  page.panel.scrollTop = 1771;
  tracker.scroll(page.html);
  assert.deepEqual(tracker.sent("scroll"), [{ depth: 50 }]);
});
