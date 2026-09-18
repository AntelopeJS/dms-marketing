import type { RequestContext } from "@antelopejs/interface-api";

/** Response surface actually used here; interface-api types it loosely. */
interface WritableResponse {
  addHeader(name: string, value: string): void;
  getWriteStream(contentType: string): { end(data: string): void };
}

const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

/**
 * Shared skin of the playground's fictional visitor sites. Sections are tall
 * on purpose: the heatmap's scroll overlay needs a page that actually scrolls,
 * and its click overlay needs the document to be taller than the probe frame.
 */
export const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  body {
    margin: 0 auto; padding: 2rem 1.5rem 6rem; max-width: 44rem;
    font: 16px/1.6 system-ui, sans-serif;
  }
  h1 { margin-top: 0; }
  nav { display: flex; gap: 1rem; margin-bottom: 2rem; }
  section { min-height: 70vh; border-top: 1px solid #8884; padding-top: 1rem; }
  .cards { display: flex; gap: 1rem; }
  .card { flex: 1; border: 1px solid #8886; border-radius: 8px; padding: 1rem; }
  button {
    font: inherit; padding: 0.6rem 1.1rem; margin-right: 0.75rem;
    border: 1px solid #8886; border-radius: 6px; cursor: pointer;
  }
  form label { display: block; margin: 0.5rem 0; }
  input { font: inherit; padding: 0.4rem 0.6rem; }
  #log {
    position: fixed; right: 1rem; bottom: 1rem; max-width: 20rem;
    padding: 0.5rem 0.75rem; border: 1px solid #8886; border-radius: 6px;
    background: Canvas; font: 12px/1.5 ui-monospace, monospace;
  }
`;

/**
 * Tracker tag of one fixture site. The sample rate is forced because the 0.1
 * default would leave click and scroll events to chance.
 */
export function trackerSnippet(
  websiteId: string,
  heatmapSample: string,
): string {
  return `<script defer src="/api/marketing/tracker.js" data-website-id="${websiteId}"
   data-heatmap-sample="${heatmapSample}" data-do-not-track="false"></script>`;
}

/** `head` carries the tracker tag, or nothing for a deliberately untracked page. */
export function layout(title: string, head: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${PAGE_STYLE}</style>
  ${head}
</head>
<body>
  ${body}
</body>
</html>`;
}

/**
 * `framable: false` sends the refusal every production site sends by
 * default (Nginx, Cloudflare, Helmet), so the heatmap backdrop is exercised
 * the way real sites exercise it.
 */
export function write(
  context: RequestContext,
  html: string,
  framable = true,
): void {
  const response = context.response as unknown as WritableResponse;
  if (!framable) {
    response.addHeader("X-Frame-Options", "DENY");
  }
  response.getWriteStream(HTML_CONTENT_TYPE).end(html);
}
