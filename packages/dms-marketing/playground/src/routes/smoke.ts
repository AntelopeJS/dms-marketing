import {
  Context,
  Controller,
  Get,
  type RequestContext,
} from "@antelopejs/interface-api";

import { layout, trackerSnippet, write } from "./site-shell";

/**
 * Second fixture website, created by the e2e smoke run rather than by the
 * seed. Its domain is `smoke.test`, which the module config maps back to this
 * origin so the heatmap has a backdrop to draw over.
 */
export const SMOKE_WEBSITE_ID = "smoke-site-1";

const SMOKE_HEATMAP_SAMPLE = "1";

const TRACKER_SNIPPET = trackerSnippet(SMOKE_WEBSITE_ID, SMOKE_HEATMAP_SAMPLE);

const SECTION_COUNT = 4;

const NAV = `<nav>
  <a href="/pricing">Pricing</a>
  <a href="/checkout">Checkout</a>
</nav>`;

function smokePage(title: string, main: string): string {
  return layout(
    title,
    TRACKER_SNIPPET,
    `${NAV}
  ${main}`,
  );
}

function fillerSections(): string {
  return Array.from({ length: SECTION_COUNT }, (_, index) => {
    const rank = index + 1;
    return `<section id="section-${rank}">
      <h2>Section ${rank}</h2>
      <p>Filler paragraph ${rank}, tall enough that the recorded clicks and
      scroll depths of this page land somewhere on the drawn surface.</p>
    </section>`;
  }).join("\n");
}

function pricingPage(): string {
  return smokePage(
    "Smoke Shop — pricing",
    `<h1>Pricing</h1>
  <p>Fictional visitor site of website <code>${SMOKE_WEBSITE_ID}</code>.</p>
  <div class="cards">
    <div class="card"><h2>Basic</h2><p>9€/mo</p></div>
    <div class="card"><h2>Team</h2><p>29€/mo</p></div>
  </div>
  <p><a href="/checkout">Go to checkout →</a></p>
  ${fillerSections()}`,
  );
}

function checkoutPage(): string {
  return smokePage(
    "Smoke Shop — checkout",
    `<h1>Checkout</h1>
  <p>Last step of the smoke journey (funnel: pricing → checkout).</p>
  <p><button id="pay">Pay now</button></p>
  ${fillerSections()}`,
  );
}

/**
 * Public half of the smoke website. Served from the playground origin so the
 * tracker can capture its pages — the paths match the ones the smoke run
 * recorded events against.
 */
export class SmokeController extends Controller("/") {
  @Get("pricing")
  async pricing(@Context() context: RequestContext) {
    write(context, pricingPage());
  }

  @Get("checkout")
  async checkout(@Context() context: RequestContext) {
    write(context, checkoutPage());
  }
}
