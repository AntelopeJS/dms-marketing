# Known issues

Found while exercising the module end-to-end against the playground
(backend `:5010`, CMS `:3001`, a tracked demo site on `:3000`) on 2026-08-15.

Three earlier entries are fixed or no longer reachable, kept here only as one-line history:

- Click coordinates depended on the visitor's window size — fixed by
  anchoring clicks to the element they hit (see *Heatmap anchoring* in
  [docs/architecture.md](docs/architecture.md#heatmap-anchoring)). Clicks
  captured before that fix keep document fractions only, so their position
  under the overlay is still approximate.
- A deep link to a heatmap path landed on the first page of the inventory
  instead. The cause was not the sequence the original notes suspected: on
  the immediate run of a multi-source watcher, Vue hands the callback an
  EMPTY `previous` array — truthy — so `if (previous && next[0] !==
  previous[0])` cleared the linked path at setup, on every deep link, site
  in the URL or not. The guard now clears only on a real site-to-site
  change (`frontend-vue/app/components/PagesView.vue`), verified end-to-end:
  linked paths survive (with and without `website`), and switching sites
  still resets the selection. The explorer that replaced that view
  (`frontend-vue/app/components/PagesExplorer.vue`) keeps the same rule.
- Creating a funnel showed an error toast next to the success toast — a
  `useForm` bug in the DMS core (the post-success work shares the
  submission's `try`). The funnel builder no longer goes through the stock
  form: it writes to the funnels data API itself, so this module no longer
  reaches it.
