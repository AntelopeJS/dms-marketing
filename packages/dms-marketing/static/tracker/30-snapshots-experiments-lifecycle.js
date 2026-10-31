  // --- Page snapshots (negotiated, sampled with the clicks) -----------------

  const snapshotEndpoint = `${hostUrl}/api/marketing/snapshot`;
  let snapshotsRequested = 0;

  /**
   * Ask whether the backend wants a capture of this page at this width; the
   * answer is the capture script itself, or nothing. Only on visits already
   * sampled for clicks — a backdrop is for pages with clicks — and never
   * from inside a frame, a hidden tab or a prerender: none of them is what
   * the visitor saw.
   */
  function requestSnapshot() {
    if (
      !heatmapSampled ||
      !websiteId ||
      script.getAttribute("data-website-id") !== websiteId ||
      pageExcluded ||
      snapshotsRequested >= MAX_SNAPSHOTS_PER_LOAD ||
      window.top !== window ||
      document.visibilityState !== "visible" ||
      innerWidth <= 0
    ) {
      return;
    }
    snapshotsRequested++;
    // The upload is only accepted for the page the visit's last pageview
    // named: that pageview must be on its way before the capture is.
    flush();
    const path = location.pathname;
    window[SNAPSHOT_CONTEXT_GLOBAL] = {
      website: websiteId,
      endpoint: snapshotEndpoint,
      path: path,
      // Looked for at capture time, the page as it is then.
      scrollRoot: findScrollRoot,
    };
    const loader = document.createElement("script");
    loader.async = true;
    loader.src =
      `${hostUrl}/api/marketing/snapshot.js?website=${encodeURIComponent(websiteId)}` +
      `&path=${encodeURIComponent(path)}&width=${innerWidth}` +
      // Lets the backend replace a capture taken before captures marked the
      // scroll root, instead of waiting for it to age.
      (scrollRoot() ? "&root=1" : "");
    const settle = () => loader.remove();
    loader.addEventListener("load", settle);
    loader.addEventListener("error", settle);
    document.head.appendChild(loader);
  }

  function whenIdle(callback) {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(callback);
      return;
    }
    setTimeout(callback, 0);
  }

  /** After load, a grace period and in idle time: the capture must never
   * compete with the page's own work. */
  function scheduleSnapshot() {
    const later = () => {
      setTimeout(() => whenIdle(requestSnapshot), SNAPSHOT_DELAY_MS);
    };
    if (document.readyState === "complete") {
      later();
      return;
    }
    window.addEventListener("load", later, { once: true });
  }

  // --- Experiments ----------------------------------------------------------

  /** Global the assignments script (experiments.js) publishes through. */
  const ASSIGNMENTS_GLOBAL = "__dmsMarketingAssignments";

  let assignmentsPromise = null;

  /**
   * Lazy: the request fires on the first variation() call only, so the many
   * pages without experiments never pay it. A <script src> rather than a
   * fetch() because reading a cross-origin response would need the CORS
   * grant client sites are promised never to need; per-visitor, so the
   * backend serves it no-store and it must never ride inside tracker.js
   * (which is cached shared for an hour).
   */
  function loadAssignments() {
    if (!assignmentsPromise) {
      assignmentsPromise = new Promise((resolve) => {
        const loader = document.createElement("script");
        loader.async = true;
        loader.src =
          `${hostUrl}/api/marketing/experiments.js?website=` +
          encodeURIComponent(websiteId);
        function settle() {
          const assignments = window[ASSIGNMENTS_GLOBAL];
          delete window[ASSIGNMENTS_GLOBAL];
          loader.remove();
          resolve(
            assignments && typeof assignments === "object" ? assignments : {},
          );
        }
        loader.addEventListener("load", settle);
        loader.addEventListener("error", settle);
        document.head.appendChild(loader);
      });
    }
    return assignmentsPromise;
  }

  /** One exposure per experiment per page load — all the per-session variation
   * split needs, and what keeps long SPA sessions from flooding collect. */
  const exposedExperiments = new Set();

  function reportExposure(experiment, variation) {
    if (exposedExperiments.has(experiment)) {
      return;
    }
    exposedExperiments.add(experiment);
    enqueue(
      Object.assign(base(), {
        kind: "exposure",
        name: experiment,
        data: { experiment: experiment, variation: variation },
      }),
    );
  }

  publishApi({
    track(name, data) {
      enqueue(
        Object.assign(base(), {
          kind: "custom",
          name:
            typeof name === "string"
              ? name.slice(0, MAX_EVENT_NAME_LENGTH)
              : name,
          data,
        }),
      );
    },
    /** Assigned variation of a running experiment, or null. Reports the
     * exposure, so only call it where the variation is actually applied. */
    variation(experiment) {
      const requestedWebsite = websiteId;
      if (!requestedWebsite || script.getAttribute("data-website-id") !== requestedWebsite) {
        return Promise.resolve(null);
      }
      return loadAssignments().then((assignments) => {
        if (websiteId !== requestedWebsite || script.getAttribute("data-website-id") !== requestedWebsite) {
          return null;
        }
        const assigned = assignments[experiment];
        if (typeof assigned !== "string") {
          return null;
        }
        reportExposure(experiment, assigned);
        return assigned;
      });
    },
    /** Low-level escape hatch for integrations that assign on their own. */
    exposure(experiment, variation) {
      reportExposure(experiment, variation);
    },
  });

  // --- Lifecycle ------------------------------------------------------------

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushScrollDepth();
      flush();
    }
  });
  window.addEventListener("pagehide", () => {
    flushScrollDepth();
    flush();
  });

  /**
   * The tag's website changed: what was collected so far leaves under the
   * previous one, and the page on screen counts for the new one. The
   * assignments were the previous website's experiments.
   */
  function followWebsiteId() {
    const next = script.getAttribute("data-website-id") || null;
    if (next === websiteId) {
      return;
    }
    flushScrollDepth();
    flush();
    websiteId = next;
    assignmentsPromise = null;
    exposedExperiments.clear();
    lastPath = null;
    trackPageview();
  }

  if (typeof MutationObserver === "function") {
    new MutationObserver(followWebsiteId).observe(script, {
      attributes: true,
      attributeFilter: ["data-website-id"],
    });
  }

  trackPageview();
})();
