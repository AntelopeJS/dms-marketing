/**
 * The screenshots of the dms-marketing docs, taken on the Helio demo, whose
 * public website, funnels and twelve weeks of traffic the demo imports at
 * provisioning. The onboarding runs first and creates the administrator every
 * scene uses. The import runs in the background, oldest day first, for longer
 * than one wait allows, so setup scenes on the live Overview follow the date
 * of the last imported event week by week, then wait for the 4,348 sessions
 * of the full history before any scene that shows traffic. The funnels list
 * keeps its results for a while, so nothing opens it before the import ends.
 * All scenes share one browser session, so no scene signs out.
 */
export default [
  {
    id: "onboarding",
    route: "/onboarding",
    setup: true,
    steps: [
      { action: "fill", selector: 'input[name="name"]', value: "Helio" },
      {
        action: "click",
        selector: 'button:has-text("Continue to administrator")',
      },
      { action: "wait", selector: 'input[name="firstName"]' },
      { action: "fill", selector: 'input[name="firstName"]', value: "Sophie" },
      { action: "fill", selector: 'input[name="lastName"]', value: "Lambert" },
      {
        action: "fill",
        selector: 'input[name="email"]',
        value: "sophie.lambert@helio.be",
      },
      {
        action: "fill",
        selector: 'input[name="password"]',
        value: "HelioDocs2026!",
      },
      {
        action: "click",
        selector: 'button:has-text("Create administrator account")',
      },
      { action: "wait", selector: 'button:has-text("Open the dashboard")' },
      { action: "click", selector: 'button:has-text("Open the dashboard")' },
    ],
  },
  {
    id: "website-settings",
    route: "/modules/marketing/websites",
    steps: [
      { action: "click", selector: '[aria-label^="Settings of Helio"]' },
      { action: "wait", selector: '[role="dialog"]' },
    ],
    output: "packages/dms-marketing/docs/images/captures/website-settings.webp",
  },
  {
    id: "open-acquisition",
    route: "/modules/marketing/acquisition",
    setup: true,
  },
  {
    id: "open-pages",
    route: "/modules/marketing/pages",
    setup: true,
  },
  {
    id: "history-3-weeks",
    route: "/modules/marketing/overview",
    setup: true,
    steps: [
      {
        action: "wait",
        selector: "text=/^(1?[0-9]|20) days? ago$|hours? ago|min\\. ago/",
      },
    ],
  },
  {
    id: "history-2-weeks",
    route: "/modules/marketing/overview",
    setup: true,
    steps: [
      {
        action: "wait",
        selector: "text=/^(1[0-4]|[0-9]) days? ago$|hours? ago|min\\. ago/",
      },
    ],
  },
  {
    id: "history-1-week",
    route: "/modules/marketing/overview",
    setup: true,
    steps: [
      {
        action: "wait",
        selector: "text=/^[0-7] days? ago$|hours? ago|min\\. ago/",
      },
    ],
  },
  {
    id: "history-today",
    route: "/modules/marketing/overview",
    setup: true,
    steps: [{ action: "wait", selector: "text=/hours? ago|min\\. ago/" }],
  },
  {
    id: "history-done",
    route: "/modules/marketing/overview",
    setup: true,
    steps: [{ action: "wait", selector: 'text="4,348"' }],
  },
  {
    id: "websites",
    route: "/modules/marketing/websites",
    output: "packages/dms-marketing/docs/images/captures/websites.webp",
  },
  {
    id: "install-guide",
    route: "/modules/marketing/websites",
    steps: [
      {
        action: "click",
        selector:
          'a:has-text("Finish install"), button:has-text("Finish install")',
      },
      { action: "wait", selector: 'text="Paste the script on every page"' },
    ],
    output: "packages/dms-marketing/docs/images/captures/install-guide.webp",
  },
  {
    id: "settings",
    route: "/modules/marketing/settings",
    output: "packages/dms-marketing/docs/images/captures/settings.webp",
  },
  {
    id: "funnel-builder",
    route: "/modules/marketing/funnel-builder",
    output: "packages/dms-marketing/docs/images/captures/funnel-builder.webp",
  },
  {
    id: "overview",
    route: "/modules/marketing/overview",
    output: "packages/dms-marketing/docs/images/captures/overview.webp",
  },
  {
    id: "acquisition",
    route: "/modules/marketing/acquisition",
    output: "packages/dms-marketing/docs/images/captures/acquisition.webp",
  },
  {
    id: "heatmap",
    route: "/modules/marketing/pages",
    output: "packages/dms-marketing/docs/images/captures/heatmap.webp",
  },
  {
    id: "scroll-depth",
    route: "/modules/marketing/pages",
    steps: [{ action: "click", selector: 'button:has-text("Scroll")' }],
    output: "packages/dms-marketing/docs/images/captures/scroll-depth.webp",
  },
  {
    id: "funnels",
    route: "/modules/marketing/funnels",
    output: "packages/dms-marketing/docs/images/captures/funnels.webp",
  },
  {
    id: "funnel-report",
    route: "/modules/marketing/funnel?id=helio-autumn-battery",
    output: "packages/dms-marketing/docs/images/captures/funnel-report.webp",
  },
  {
    id: "ab-test",
    route: "/modules/marketing/funnel?id=helio-callback",
    output: "packages/dms-marketing/docs/images/captures/ab-test.webp",
  },
];
