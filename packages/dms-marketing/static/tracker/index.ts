/**
 * dms-marketing first-party tracker, served by `GET /api/marketing/tracker.js`
 * as one script with the module's effective settings prepended in
 * `window.__dmsMarketingTrackerConfig`.
 *
 * The tag, its attributes, the privacy signals it honours, the page API it
 * installs and what it records are documented in
 * `docs/2.installation.md` and `docs/4.usage/9.tracking.md`.
 *
 * Cookieless by design: no identifier is generated or stored client-side, the
 * backend derives an anonymous visitor hash per request. Events are batched
 * and flushed with `sendBeacon`, so page unloads lose nothing.
 *
 * @packageDocumentation
 */
import { createApi, NOOP_API, publishApi } from "./api";
import { installClickCapture } from "./clicks";
import { createExperiments } from "./experiments";
import { installLifecycle } from "./lifecycle";
import { createOutbox } from "./outbox";
import { createPageviews } from "./pageviews";
import { isTrackingRefused } from "./privacy";
import { createScrollDepth } from "./scroll-depth";
import { createScrollRoots } from "./scroll-root";
import { isTagElement, openSession, type TrackerSession } from "./session";
import { servedConfig } from "./settings";
import { createSnapshotRequests } from "./snapshot-request";

function collect(session: TrackerSession): void {
  const outbox = createOutbox(session);
  const scrollRoots = createScrollRoots();
  const scrollDepth = createScrollDepth(session, outbox, scrollRoots);
  const snapshots = createSnapshotRequests(session, outbox, scrollRoots);
  const experiments = createExperiments(session.hostUrl, outbox);
  const pageviews = createPageviews(session, outbox, scrollDepth, snapshots);

  pageviews.install();
  scrollDepth.install();
  installClickCapture(session, outbox, scrollRoots);
  publishApi(createApi(session, outbox, experiments));
  installLifecycle(session, outbox, scrollDepth, experiments, pageviews);
  pageviews.track();
}

function start(): void {
  const served = servedConfig();
  if (served.paused) {
    window.dmsMarketing = window.dmsMarketing || NOOP_API;
    return;
  }
  const script = document.currentScript;
  if (!isTagElement(script)) {
    return;
  }
  if (window.__dmsMarketingInstalled) {
    console.warn("[dms-marketing] tracker included twice; ignoring the copy.");
    return;
  }
  window.__dmsMarketingInstalled = true;
  if (isTrackingRefused(script)) {
    publishApi();
    return;
  }
  collect(openSession(script, served));
}

start();
