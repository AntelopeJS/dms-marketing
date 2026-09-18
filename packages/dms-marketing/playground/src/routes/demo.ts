import {
  Context,
  Controller,
  Get,
  type RequestContext,
} from "@antelopejs/interface-api";

import { layout, trackerSnippet, write } from "./site-shell";

/** Seeded at start by the playground (see ../seed.ts). */
export const DEMO_WEBSITE_ID = "test-site-1";

/** Full capture: the 0.1 default would leave click/scroll events to chance. */
const DEMO_HEATMAP_SAMPLE = "1";

/** Filler sections on the landing page, enough to make it scroll. */
const SECTION_COUNT = 6;

/** SPA target pushed to history — no server route backs it, on purpose. */
const SPA_PATH = "/demo/page-2";

/** Custom events fired by the visitor journey (future funnel steps). */
const CTA_EVENT_NAME = "demo_cta";
const SIGNUP_EVENT_NAME = "signup_submitted";

const TRACKER_SNIPPET = trackerSnippet(DEMO_WEBSITE_ID, DEMO_HEATMAP_SAMPLE);

const NAV = `<nav>
  <a href="/demo">Home</a>
  <a href="/demo/pricing">Pricing</a>
  <a href="/demo/signup">Sign up</a>
  <a href="/demo/away">Leave</a>
</nav>`;

const LOG_SCRIPT = `<div id="log">ready</div>
<script>
  window.demoNote = (text) => {
    document.getElementById("log").textContent = text;
  };
</script>`;

/**
 * `tracked` is off only for the away page, whose sole purpose is to trigger a
 * pagehide flush by leaving the tracked area.
 */
function demoPage(title: string, main: string, tracked: boolean): string {
  return layout(
    title,
    tracked ? TRACKER_SNIPPET : "",
    `${NAV}
  ${main}
  ${tracked ? LOG_SCRIPT : ""}`,
  );
}

function fillerSections(): string {
  return Array.from({ length: SECTION_COUNT }, (_, index) => {
    const rank = index + 1;
    return `<section id="section-${rank}">
      <h2>Section ${rank}</h2>
      <p>Filler paragraph ${rank} — scroll past it so the tracker records a
      growing scroll depth. Click anywhere to emit click events with
      viewport-normalized coordinates.</p>
      <p class="clickable">Another clickable paragraph in section ${rank}.</p>
    </section>`;
  }).join("\n");
}

function landingPage(): string {
  return demoPage(
    "Demo SaaS — home",
    `<h1>Demo SaaS</h1>
  <p>Fictional visitor site of the dms-marketing playground. Website
  <code>${DEMO_WEBSITE_ID}</code>, heatmap sampling forced to
  <code>${DEMO_HEATMAP_SAMPLE}</code>, browser DNT ignored.</p>
  <p>
    <button id="cta">Try it now</button>
    <button id="spa">page 2 (pushState)</button>
  </p>
  <form id="guide">
    <label>Work email <input type="email" name="email" value="jane@example.com"></label>
    <label>Company <input type="text" name="company" value="Acme Corp"></label>
    <input type="hidden" name="csrf" value="never-in-a-snapshot">
    <button type="button" id="guide-submit">Get the guide</button>
  </form>
  <p id="greeting" class="dms-marketing-mask">Welcome back, Jane Doe — your cart holds 3 items.</p>
  <div id="account" class="card" data-dms-marketing-block>Account 4242 · balance 1,250 €</div>
  ${fillerSections()}
  <script>
    document.getElementById("cta").addEventListener("click", () => {
      window.dmsMarketing.track("${CTA_EVENT_NAME}", { origin: "landing" });
      window.demoNote("tracked ${CTA_EVENT_NAME}");
    });
    document.getElementById("spa").addEventListener("click", () => {
      history.pushState({}, "", "${SPA_PATH}");
      window.demoNote("pushState -> ${SPA_PATH}");
    });
  </script>`,
    true,
  );
}

function pricingPage(): string {
  return demoPage(
    "Demo SaaS — pricing",
    `<h1>Pricing</h1>
  <p>Second step of the visitor journey (funnel: home → pricing → sign up).</p>
  <div class="cards">
    <div class="card"><h2>Starter</h2><p>19€/mo</p></div>
    <div class="card"><h2>Pro</h2><p>49€/mo</p></div>
    <div class="card"><h2>Scale</h2><p>99€/mo</p></div>
  </div>
  <p><a href="/demo/signup">Choose a plan →</a></p>`,
    true,
  );
}

function signupPage(): string {
  return demoPage(
    "Demo SaaS — sign up",
    `<h1>Sign up</h1>
  <p>Final step of the journey. The button fires the
  <code>${SIGNUP_EVENT_NAME}</code> custom event — the conversion a funnel
  definition will target.</p>
  <p><button id="signup">Create my account</button></p>
  <script>
    document.getElementById("signup").addEventListener("click", () => {
      window.dmsMarketing.track("${SIGNUP_EVENT_NAME}", { plan: "pro" });
      window.demoNote("tracked ${SIGNUP_EVENT_NAME}");
    });
  </script>`,
    true,
  );
}

function awayPage(): string {
  return demoPage(
    "away from the demo",
    `<h1>Away</h1>
  <p>No tracker here — this page only exists so leaving the demo site
  fires <code>pagehide</code> and flushes the queue over sendBeacon.</p>`,
    false,
  );
}

/**
 * Fictional visitor site: a three-page journey (home → pricing → sign up)
 * embedding the real `/api/marketing/tracker.js` same-origin, plus an
 * untracked exit page. This is the "public" half of the playground; the
 * other half is the DMS back office rendering the module's Marketing pages.
 * Every page refuses framing, as production sites do, and the landing page
 * carries a prefilled form, a masked greeting and a blocked widget so its
 * snapshot proves the privacy rules.
 */
export class DemoController extends Controller("/") {
  @Get("demo")
  async demo(@Context() context: RequestContext) {
    write(context, landingPage(), false);
  }

  @Get("demo/pricing")
  async pricing(@Context() context: RequestContext) {
    write(context, pricingPage(), false);
  }

  @Get("demo/signup")
  async signup(@Context() context: RequestContext) {
    write(context, signupPage(), false);
  }

  @Get("demo/away")
  async away(@Context() context: RequestContext) {
    write(context, awayPage(), false);
  }
}
