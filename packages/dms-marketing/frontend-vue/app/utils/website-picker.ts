/**
 * Where the website picker sits. The context bar leads with it on every
 * analytics page; a page whose blocks carry it themselves (Pages & heatmaps,
 * at the top of its pages panel) turns the bar's off with `websitePicker:
 * false`. The bar still shows it whenever it renders no block — the waiting
 * guide, the loading skeleton — or the page would offer no way to switch.
 */
export function barShowsWebsitePicker(
  option: boolean,
  blocksShown: boolean,
): boolean {
  return option || !blocksShown
}

/** A website as the picker lists it: its state already put in words. */
export interface WebsitePickerItem {
  id: string
  name: string
  domain: string
  /** The class of the state's dot. */
  dot: string
  /** "Live · last event 2 minutes ago". */
  line: string
}

/** The selected website's state beside the picker. */
export interface WebsitePickerState {
  dot: string
  /** Compact: the age of the last event, else the state. */
  label: string
  /** The full line, for the tooltip and screen readers. */
  hint: string
}
