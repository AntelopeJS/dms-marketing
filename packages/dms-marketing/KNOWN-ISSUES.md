# Known issues

Found while exercising the module end-to-end against the playground
(backend `:5010`, CMS `:3001`, a tracked demo site on `:3000`) on 2026-08-15.

Two earlier entries are fixed and kept here only as one-line history:

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
  still resets the selection.

## 1. Creating a funnel raises an error toast next to the success toast

**Where:** `useForm.ts` in the `cms-ui` layer (the CMS core), reached through
this module's funnels TableView.

**Symptom.** Saving a new funnel shows *"Data has been successfully saved"*
immediately followed by *"An unknown error occurred"*. The row is created
correctly and the app navigates back to the list. Editing an existing funnel
shows only the success toast.

**Reproduction.** 4 creations, 4 error toasts. 1 edit, none.

**Ruled out.** Every request succeeds (`POST tables/funnels/new` → 200, the
realtime subscribe and the list reload → 200/204); no unhandled rejection, no
`window.onerror`, and no Vue Router navigation error is raised (checked with
listeners installed before submitting).

**Cause.** `onSubmit` wraps both the submission *and* the post-success work in
one `try`, so anything thrown after the request succeeded is reported as a
failed submission:

```ts
try {
  await executeSubmit(/* POST */)
  submitSucceeded.value = true
  await handleSubmitSuccess(submitResponse, plainData)  // success toast, callback, navigateTo
} catch (error) {
  showSubmitErrorToast(error as EventError)             // "An unknown error occurred"
}
```

**This module's part in it.** None that is visible: the funnels page declares a
plain TableView (`src/pages/funnels/page.ts`) and sets neither
`redirectOnSuccess` nor `onSuccessCallback`. The fix belongs in `cms-ui` —
narrow the `try` to the submission, or let the post-success phase report its own
failures. Worth confirming on a TableView outside this module before filing it
there.

**Why it matters.** It is cosmetic, but it trains owners to ignore error toasts
on the one screen where a real save failure would look identical.
