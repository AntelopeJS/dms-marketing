import { Context, Controller, Get, type RequestContext } from "@antelopejs/interface-api";

const SCRIPT_PATH = "/api/marketing/tracker.js";

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Whether a parsed JSON value is an object whose entries can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * A visitor site for the tracker journeys: a page that loads the tracker from the API's origin. The query names
 * the website (`w`), extra attributes of the tag (`attrs`, JSON), a second tag (`twice`), a `type="module"` tag
 * (`module`), and a script to run after the tracker (`js`). Only the verification playground serves it.
 */
export class VerifySiteController extends Controller("/verify-marketing/site") {
  @Get("/:first")
  one(@Context() context: RequestContext) {
    return this.render(context);
  }

  @Get("/:first/:second")
  two(@Context() context: RequestContext) {
    return this.render(context);
  }

  private render(context: RequestContext) {
    const url = new URL(context.rawRequest.url ?? "/", "http://placeholder");
    const website = url.searchParams.get("w") ?? "";
    const attrs: unknown = JSON.parse(url.searchParams.get("attrs") ?? "{}");
    const attributes = Object.entries(isRecord(attrs) ? attrs : {}).map(([name, value]) => ` ${name}="${escapeAttribute(String(value))}"`).join("");
    const tag = `<script defer ${url.searchParams.get("module") ? 'type="module" ' : ""}src="${SCRIPT_PATH}" data-website-id="${escapeAttribute(website)}"${attributes}></script>`;
    const body = `<!doctype html><html lang="fr-FR"><head><meta charset="utf-8"><title>${escapeAttribute(url.pathname)}</title></head><body style="margin:0"><main id="app" style="min-height:2400px"><h1>${escapeAttribute(url.pathname)}</h1><button id="buy" style="margin:40px;width:160px;height:48px">Buy</button><a id="next" href="/verify-marketing/site/second?w=${escapeAttribute(website)}">next</a></main>${tag}${url.searchParams.get("twice") ? tag : ""}<script>${url.searchParams.get("js") ?? ""}</script></body></html>`;
    context.response.setStatus(200);
    context.response.addHeader("Content-Type", "text/html; charset=utf-8");
    context.response.getWriteStream("text/html; charset=utf-8").end(body);
  }
}
