const assert = require("node:assert/strict");
const { gzipSync } = require("node:zlib");
const test = it;
const {
  createStyleCollector,
  splitSelectorList,
  testedSelector,
} = require("../static/snapshot.js");
const { getConfig, setConfig } = require("../dist/config");
const { inflateIfGzipped } = require("../dist/services/request-body");
const { storedDocument } = require("../dist/services/snapshots");
const {
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_MAX_BYTES,
  MAX_STORED_SNAPSHOT_CHARS,
  MIN_SNAPSHOT_MAX_BYTES,
} = require("../dist/types/constants");

const BASE = "https://shop.example.com/";

after(() => setConfig({}));

// --- A CSSOM small enough to write by hand ----------------------------------

/** A style rule; custom properties come from its declarations. */
function styleRule(selectorText, declarations = "", nested) {
  const names = [...declarations.matchAll(/(--[\w-]+):\s*([^;]*);/g)];
  const style = names.map((match) => match[1]);
  style.getPropertyValue = (name) =>
    names.find((match) => match[1] === name)?.[2].replace(/ !important$/, "");
  style.getPropertyPriority = (name) =>
    names.find((match) => match[1] === name)?.[2].endsWith("!important")
      ? "important"
      : "";
  const body = nested ? nested.map((rule) => rule.cssText).join(" ") : "";
  return {
    type: 1,
    selectorText,
    style,
    cssRules: nested,
    cssText: `${selectorText} { ${declarations}${body ? ` ${body}` : ""} }`,
  };
}

function groupRule(prelude, rules, type = 4) {
  return {
    type,
    cssRules: rules,
    cssText: `${prelude} { ${rules.map((rule) => rule.cssText).join(" ")} }`,
  };
}

function atRule(type, cssText) {
  return { type, cssText };
}

/** A scope answering `querySelector` for the selectors listed as present;
 * `throws` lists what its parser would refuse. */
function scope(present, throws = []) {
  return {
    querySelector(selector) {
      if (throws.includes(selector)) {
        throw new SyntaxError(selector);
      }
      return present.includes(selector) ? {} : null;
    },
  };
}

function sheet(rules) {
  return { cssRules: rules };
}

function capture(sheets, present, throws) {
  const styles = createStyleCollector();
  const root = scope(present, throws);
  const segments = sheets.map((rules) =>
    styles.sheetSegments(sheet(rules), BASE, root),
  );
  return { styles, finish: () => styles.finish(segments) };
}

// --- Selectors ---------------------------------------------------------------

test("a state or a pseudo-element is tested on its element", () => {
  assert.equal(testedSelector(".a:hover::before"), ".a");
  assert.equal(testedSelector(".b:focus-visible > .c"), ".b>.c");
  assert.equal(testedSelector(".a > ::before"), ".a>*");
  assert.equal(testedSelector("::selection"), "*");
  assert.equal(testedSelector(".a:not(:hover)"), ".a");
  assert.equal(testedSelector("details:open > summary"), "details>summary");
  // Untouched when there is nothing to strip.
  assert.equal(testedSelector("li:nth-child(2n + 1)"), "li:nth-child(2n + 1)");
});

test("an escaped colon stays part of its class name", () => {
  assert.equal(
    testedSelector(".hover\\:underline:hover"),
    ".hover\\:underline",
  );
  assert.equal(
    testedSelector(".md\\:hover\\:flex:hover"),
    ".md\\:hover\\:flex",
  );
  assert.equal(testedSelector(".focus\\:ring"), ".focus\\:ring");
});

test("what querySelector cannot answer from the scope is not tested", () => {
  assert.equal(testedSelector(":host .x"), null);
  assert.equal(testedSelector("::slotted(p)"), null);
  assert.equal(testedSelector("& .child"), null);
});

test("a selector list splits on its top-level commas only", () => {
  assert.deepEqual(splitSelectorList('a:is(b, c), d[x=","] , e'), [
    "a:is(b, c)",
    'd[x=","]',
    "e",
  ]);
});

// --- Pruning -----------------------------------------------------------------

test("only the rules matching the document are kept", () => {
  const { finish } = capture(
    [
      [
        styleRule(".used", "color: red;"),
        styleRule(".unused", "color: blue;"),
        styleRule(".unused, .used-too", "margin: 0;"),
        styleRule(".button:hover", "color: green;"),
        styleRule(".tip::after", "content: 'x';"),
      ],
    ],
    [".used", ".used-too", ".button"],
  );
  const [css] = finish();
  assert.match(css, /\.used \{/);
  assert.match(css, /\.used-too/);
  assert.match(css, /\.button:hover/);
  assert.doesNotMatch(css, /\.unused \{/);
  assert.doesNotMatch(css, /\.tip/);
});

test("a selector the browser refuses is kept", () => {
  const { finish } = capture(
    [[styleRule(".x:-moz-focusring", "outline: 0;")]],
    [],
    [".x:-moz-focusring"],
  );
  assert.match(finish()[0], /-moz-focusring/);
});

test("a nested block stays whole when its parent matches, goes when not", () => {
  const { finish } = capture(
    [
      [
        styleRule(".hover\\:bg", "", [styleRule("&:hover", "color: red;")]),
        styleRule(".prose", "", [styleRule("& p", "margin: 0;")]),
      ],
    ],
    [".hover\\:bg"],
  );
  const [css] = finish();
  assert.match(css, /&:hover/);
  assert.doesNotMatch(css, /\.prose/);
});

test("wrappers stay around the rules they still hold, layers even empty", () => {
  const { finish } = capture(
    [
      [
        atRule(0, "@layer theme, base, utilities;"),
        groupRule("@layer utilities", [styleRule(".unused", "top: 0;")], 0),
        groupRule("@media (min-width: 40rem)", [
          styleRule(".used", "display: flex;"),
          styleRule(".unused", "display: grid;"),
        ]),
        groupRule("@media print", [styleRule(".unused", "display: none;")]),
        groupRule(
          "@supports (color: color-mix(in lab, red, red))",
          [styleRule(".used", "color: red;")],
          12,
        ),
      ],
    ],
    [".used"],
  );
  const [css] = finish();
  assert.match(css, /@layer theme, base, utilities;/);
  assert.match(css, /@layer utilities \{\n\}/);
  // Every layout's media query, not only the visitor's.
  assert.match(css, /@media \(min-width: 40rem\) \{\n\.used/);
  assert.doesNotMatch(css, /display: grid/);
  assert.doesNotMatch(css, /@media print/);
  assert.match(css, /@supports/);
});

test("font faces, keyframes and registered properties are kept", () => {
  const { finish } = capture(
    [
      [
        atRule(5, "@font-face { font-family: X; src: url(x.woff2); }"),
        {
          type: 7,
          cssRules: [],
          cssText: "@keyframes spin { to { rotate: 1turn; } }",
        },
        atRule(0, "@property --tw-x { syntax: '*'; inherits: false; }"),
      ],
    ],
    [],
  );
  const [css] = finish();
  assert.match(css, /@font-face/);
  assert.match(css, /url\("https:\/\/shop\.example\.com\/x\.woff2"\)/);
  assert.match(css, /@keyframes spin/);
  assert.match(css, /@property --tw-x/);
});

test("custom properties nothing refers to are dropped, transitively kept", () => {
  const { styles, finish } = capture(
    [
      [
        styleRule(
          ":root",
          "--used: var(--chain); --chain: 1px; --unused: red; --inline: blue; --loud: 0 !important;",
        ),
        styleRule(".a", "margin: var(--used);"),
      ],
      [styleRule(".b", "padding: var(--loud);")],
    ],
    [":root", ".a", ".b"],
  );
  styles.noteVariables("color: var(--inline)");
  const [css] = finish();
  assert.match(css, /--used: var\(--chain\);/);
  assert.match(css, /--chain: 1px;/);
  assert.match(css, /--inline: blue;/);
  assert.match(css, /--loud: 0 !important;/);
  assert.doesNotMatch(css, /--unused/);
});

test("a stylesheet identical to one already serialized is not repeated", () => {
  const rules = [styleRule(".used", "color: red;")];
  const { finish } = capture(
    [rules, [styleRule(".other", "color: red;")], rules],
    [".used", ".other"],
  );
  const [first, second, third] = finish();
  assert.match(first, /\.used/);
  assert.match(second, /\.other/);
  assert.equal(third, "");
});

test("a sheet the browser refuses to read is reported, not guessed", () => {
  const styles = createStyleCollector();
  const refused = {
    get cssRules() {
      throw new Error("SecurityError");
    },
  };
  assert.equal(styles.sheetSegments(refused, BASE, scope([])), null);
});

// --- Upload ------------------------------------------------------------------

test("a gzipped upload is inflated, a plain one passes through", () => {
  const json = Buffer.from(JSON.stringify({ html: "<p>x</p>" }));
  assert.equal(inflateIfGzipped(json, 1024), json);
  assert.deepEqual(inflateIfGzipped(gzipSync(json), 1024), json);
});

test("a gzipped upload never inflates past its cap", () => {
  const bomb = gzipSync(Buffer.alloc(1024 * 1024, 0x20));
  assert.ok(bomb.length < 4096);
  assert.throws(
    () => inflateIfGzipped(bomb, 64 * 1024),
    (err) => err.status === 413,
  );
  const broken = Buffer.concat([Buffer.from([0x1f, 0x8b]), Buffer.from("x")]);
  assert.throws(
    () => inflateIfGzipped(broken, 1024),
    (err) => err.status === 400,
  );
});

test("snapshotMaxBytes defaults to 1 MiB and stays within its bounds", () => {
  setConfig({});
  assert.equal(getConfig().snapshotMaxBytes, MAX_SNAPSHOT_BYTES);
  setConfig({ snapshotMaxBytes: 4 * 1024 * 1024 });
  assert.equal(getConfig().snapshotMaxBytes, 4 * 1024 * 1024);
  setConfig({ snapshotMaxBytes: 1 });
  assert.equal(getConfig().snapshotMaxBytes, MIN_SNAPSHOT_MAX_BYTES);
  setConfig({ snapshotMaxBytes: 64 * 1024 * 1024 });
  assert.equal(getConfig().snapshotMaxBytes, MAX_SNAPSHOT_MAX_BYTES);
  setConfig({ snapshotMaxBytes: "2mb" });
  assert.equal(getConfig().snapshotMaxBytes, MAX_SNAPSHOT_BYTES);
  setConfig({});
});

test("a stored document stays within a MongoDB row", function () {
  // Sanitizes and compresses a 16 MiB document.
  this.timeout(60_000);
  const page = {
    website: "w",
    url: BASE,
    viewport: { width: 1280, height: 800 },
    token: "t",
    document: { width: 1280, height: 4000 },
  };
  const small = storedDocument({ ...page, html: "<p>hello</p>" });
  assert.ok(small.html.length > 0);
  assert.deepEqual(small.document, page.document);
  // Random text barely compresses: past the stored cap it becomes an
  // oversize report instead of a row MongoDB would refuse.
  const noise = require("node:crypto")
    .randomBytes(MAX_STORED_SNAPSHOT_CHARS)
    .toString("base64");
  const huge = storedDocument({ ...page, html: `<p>${noise}</p>` });
  assert.equal(huge.html, "");
  assert.ok(huge.bytes > MAX_STORED_SNAPSHOT_CHARS);
  // The bound leaves room under 16 MiB for the row's other fields.
  assert.ok(MAX_STORED_SNAPSHOT_CHARS < 16 * 1024 * 1024 - 64 * 1024);
});
