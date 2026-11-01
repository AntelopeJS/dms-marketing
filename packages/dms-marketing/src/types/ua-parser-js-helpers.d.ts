/** Subpath types sit behind `exports`, which node10 resolution never reads. */
declare module "ua-parser-js/helpers" {
  // oxlint-disable-next-line anti-slop/no-object-parameters -- Mirrors the signature ua-parser-js publishes for this helper; narrowing it here would describe the library inaccurately.
  export function isBot(resultOrUA: object | string): boolean;
}
