# Campaigns & channels

**Where:** `/modules/marketing/campaigns` — right after the overview.

The overview says how much traffic came; this page says where it came from:
the five-channel split of sessions, and the UTM campaign table.

## What it shows

- **Channels donut** — sessions grouped as **direct / organic / social /
  referral / paid**. The channel is not something the tracker sends: it is a
  pure mapping of the session's referrer domain and `utm_medium`, applied
  when the session is counted (see below).
- **UTM campaigns table** — one row per **(source, medium, campaign)**
  triple observed on new sessions, ranked by sessions. A blank cell is a UTM
  parameter the landing URL did not carry — `?utm_source=newsletter` alone
  is a real campaign row with an empty medium and campaign. The search box
  filters server-side across the three columns.
- **Top referrers / UTM terms / contents** — the external referrer domains
  counted on new sessions (all channels, not just the referral slice — this
  is where the overview's Acquisition card lands), plus `utm_term` and
  `utm_content`, the two parameters that do not take part in the triple, as
  top lists.

## How channels are classified

Applied in order; the first match wins:

| Channel | Matches |
|---|---|
| **paid** | `utm_medium` in cpc, ppc, cpm, cpv, cpa, cpp, sem, display, banner, retargeting — or starting with `paid` (`paid-social`, `paid_search`…) |
| **social** | `utm_medium` spelling out social, or the referrer being a known social network (facebook, instagram, x/twitter, linkedin, reddit, tiktok, youtube… including shorteners like `t.co`) |
| **organic** | `utm_medium=organic`, or the referrer being a known search engine (google, bing, duckduckgo, yahoo, baidu, yandex…) |
| **referral** | any other external referrer |
| **direct** | no referrer, nothing matched |

Paid is checked first on purpose: an ad click keeps its `google.com` or
`facebook.com` referrer and would otherwise read as organic or social. A
medium the mapping does not know (`email`, `newsletter`…) keeps referrer
semantics — referral with a referrer, direct without one.

The mapping runs when the session is rolled up, and the channel is stored
nowhere else — so refining the mapping later needs no migration; sessions
counted after the change simply classify by the new rules.

## Where the numbers come from

Same source as the overview — the **daily rollups**, never raw events — so
the same caveats apply ([overview.md](overview.md#where-the-numbers-come-from)):

- A day keeps at most `MAX_ENTRIES_PER_TOP_MAP` (50) campaign triples;
  long-tail campaigns on high-cardinality days are approximate. The table
  answers up to 100 rows (200 with `limit`) and says when it truncated —
  narrow the search to see the rest.
- **Dimensions start at their ship date.** Days rolled up before the
  campaign and channel dimensions existed contribute nothing to this page;
  a window overlapping that boundary undercounts campaigns, never traffic.
- Sessions carrying no UTM at all appear in the channels donut (as direct,
  organic, social or referral) but never in the campaigns table.
