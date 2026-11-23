/**
 * dms-marketing page snapshot capture.
 *
 * Served by `GET /api/marketing/snapshot.js` to a sampled visit the backend
 * wants a capture from (see `static/tracker/`), with the site's settings
 * prepended as `window.__dmsMarketingSnapshotConfig` and the tracker's
 * context waiting in `window.__dmsMarketingSnapshotContext`. Serializes the
 * rendered DOM, what the visitor sees whatever built it, into one
 * self-contained HTML document and uploads it as the heatmap's backdrop.
 *
 * Privacy, unconditionally: no form value, hidden input, script, event
 * handler or framed document leaves the page. `contenteditable` text is
 * masked, as is everything under `data-dms-marketing-mask` (or the
 * `dms-marketing-mask` class): text, the attributes that carry text (title,
 * alt, labels, placeholders, data-*) and the path of its links.
 * `data-dms-marketing-block` (or the `dms-marketing-block` class) replaces an
 * element with an empty box of its size. `maskText` masks every text node and
 * text attribute of the page; data-* and link paths stay, since styles select
 * on them.
 *
 * Transient overlays open at capture time (a prompt, a toast, an open menu or
 * popover floating over the page) are left out, see `isTransientOverlay`:
 * they belong to that one visit, not to the page.
 *
 * A page whose document does not scroll, an inner container doing it instead
 * (see the scroll root in `static/tracker/`), is captured with that container
 * marked `data-marketing-scroll-root` and the height of its whole content
 * recorded: the preview unrolls it, as tall as the page really is.
 *
 * @packageDocumentation
 */
import { whenIdle } from "../shared/page";
import { capture } from "./capture";
import { readSnapshotConfig, readSnapshotContext } from "./settings";
import { whenSettled } from "./timing";

/** How long the idle callback may wait before it runs regardless. */
const IDLE_TIMEOUT_MS = 2000;

const config = readSnapshotConfig();
const context = readSnapshotContext();

if (config && context && window.top === window) {
  whenSettled(() =>
    whenIdle(() => void capture(config, context).catch(() => {}), {
      timeout: IDLE_TIMEOUT_MS,
    }),
  );
}
