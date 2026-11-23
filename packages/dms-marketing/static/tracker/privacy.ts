declare global {
  interface Navigator {
    /** Global Privacy Control, the opt-out signal browsers ship now that DNT is deprecated. */
    readonly globalPrivacyControl?: boolean;
  }
  interface Window {
    readonly doNotTrack?: string | null;
  }
}

/**
 * Whether the browser asks not to be tracked and the tag honours it. Global
 * Privacy Control and Do Not Track are honoured alike, unless the tag opts
 * out with `data-do-not-track="false"`.
 */
export function isTrackingRefused(script: HTMLScriptElement): boolean {
  const respectDnt = script.getAttribute("data-do-not-track") !== "false";
  const optedOut =
    navigator.doNotTrack === "1" ||
    window.doNotTrack === "1" ||
    navigator.globalPrivacyControl === true;
  return respectDnt && optedOut;
}
