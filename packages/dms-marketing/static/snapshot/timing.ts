/** Time without a DOM mutation before the page counts as settled. */
const QUIET_MS = 500;
const QUIET_DEADLINE_MS = 10000;

/** Calls back once the DOM has stopped mutating, or at the deadline on a page that never stops (a ticking clock, a looping animation). */
export function whenSettled(callback: () => void): void {
  let done = false;
  let timer: number | undefined;
  const observer = new MutationObserver(arm);

  function finish(): void {
    if (done) {
      return;
    }
    done = true;
    clearTimeout(timer);
    observer.disconnect();
    callback();
  }

  function arm(): void {
    clearTimeout(timer);
    timer = setTimeout(finish, QUIET_MS);
  }

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  arm();
  setTimeout(finish, QUIET_DEADLINE_MS);
}
