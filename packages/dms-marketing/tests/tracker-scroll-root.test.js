const assert = require("node:assert/strict");
const vm = require("node:vm");
const { TRACKER_SOURCE, parseBeacon } = require("./helpers/tracker");
const test = it;

const ORIGIN = "https://dms.example.com";
const WIDTH = 1440;
const HEIGHT = 900;

/**
 * @typedef {object} Box
 * @property {number} top
 * @property {number} left
 * @property {number} right
 * @property {number} bottom
 */

/**
 * @typedef {object} Geometry
 * @property {string} overflowY
 * @property {number} scrollTop
 * @property {number} scrollHeight
 * @property {number} clientHeight
 * @property {Box} box
 */

/**
 * @typedef {object} FakeEvent
 * @property {Element} [target]
 * @property {boolean} [isTrusted]
 * @property {number} [detail]
 * @property {number} [clientX]
 * @property {number} [clientY]
 * @property {number} [pageX]
 * @property {number} [pageY]
 */

/** @typedef {(event?: FakeEvent) => void} Listener */

/** @typedef {import("./helpers/tracker").Beacon} Beacon */

class Element {
  /**
   * @param {string} name
   * @param {Element | null} parent
   * @param {Partial<Geometry>} [geometry]
   */
  constructor(name, parent, geometry = {}) {
    this.localName = name;
    this.parentElement = parent;
    this.id = "";
    /** @type {string[]} */
    this.classList = [];
    /** @type {Set<string>} */
    this.attributes = new Set();
    this.isConnected = true;
    this.overflowY = "visible";
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.box = { top: 0, left: 0, right: WIDTH, bottom: HEIGHT };
    Object.assign(this, geometry);
  }

  /** @param {Element | null} node */
  contains(node) {
    for (let current = node; current; current = current.parentElement) {
      if (current === this) {
        return true;
      }
    }
    return false;
  }

  /** @param {string} name */
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
  const sidebar = new Element("nav", app, {
    box: { top: 0, left: 0, right: 240, bottom: HEIGHT },
  });
  return { html, body, app, panel, list, under: list, button, sidebar };
}

/** @param {ReturnType<typeof shell>} page */
function loadTracker(page) {
  const attrs = new Map(
    Object.entries({ "data-website-id": "site", "data-heatmap-sample": "1" }),
  );
  /** @type {Map<string, Listener[]>} */
  const windowListeners = new Map();
  /** @type {Map<string, Listener[]>} */
  const documentListeners = new Map();
  /** @type {Beacon[]} */
  const beacons = [];
  const all = Object.values(page).filter((node) => node instanceof Element);
  /**
   * @param {Map<string, Listener[]>} listeners
   * @returns {(type: string, listener: Listener) => Map<string, Listener[]>}
   */
  const on = (listeners) => (type, listener) =>
    listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  const context = {
    console,
    URL,
    Element,
    Math: { __proto__: Math, random: () => 0 },
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
      /**
       * @param {string} _url
       * @param {{ body: string }} blob
       */
      sendBeacon(_url, blob) {
        beacons.push(parseBeacon(blob.body));
        return true;
      },
    },
    /** @param {Element} element */
    getComputedStyle: (element) => ({ overflowY: element.overflowY }),
    document: {
      currentScript: {
        src: `${ORIGIN}/api/marketing/tracker.js`,
        /** @param {string} name */
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
      /** @param {string} selector */
      querySelector: (selector) => {
        const name = selector.slice(1, -1);
        return all.find((node) => node.hasAttribute(name)) ?? null;
      },
      querySelectorAll: () => [page.button],
    },
    Blob: class {
      /** @param {string[]} parts */
      constructor(parts) {
        this.body = parts.join("");
      }
    },
    addEventListener: on(windowListeners),
  };
  context.window = context;
  vm.runInNewContext(TRACKER_SOURCE, context);
  /**
   * @param {Map<string, Listener[]>} listeners
   * @param {string} type
   * @param {FakeEvent} [event]
   */
  const fire = (listeners, type, event) => {
    for (const listener of listeners.get(type) ?? []) {
      listener(event);
    }
  };
  return {
    /** @param {Element} target */
    scroll: (target) => fire(documentListeners, "scroll", { target }),
    /**
     * @param {Element} target
     * @param {number} clientX
     * @param {number} clientY
     */
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
    /**
     * Everything sent so far, flushed as on leaving the page.
     * @param {string} kind
     */
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
  tracker.scroll(page.list);
  assert.deepEqual(tracker.sent("scroll"), [{ depth: 50 }]);
});

test("a click's document fraction is taken in the unrolled content", () => {
  const page = shell();
  const tracker = loadTracker(page);
  page.panel.scrollTop = 1000;
  tracker.click(page.button, 350, 500);
  const [click] = tracker.sent("click");
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

test("a sidebar click beside the panel is not shifted by its scroll", () => {
  const page = shell();
  const tracker = loadTracker(page);
  page.panel.scrollTop = 1000;
  tracker.click(page.sidebar, 100, 200);
  assert.equal(tracker.sent("click")[0].dy, Number((200 / 2670).toFixed(4)));
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
