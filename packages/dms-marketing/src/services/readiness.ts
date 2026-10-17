/**
 * Settles once the DMS schemas exist and the settings are loaded (the
 * DATABASE_INITIALIZED handler of src/index.ts). The interface functions
 * other modules call from their own start wait for it instead of failing on
 * a start order nobody controls.
 */
let markReady: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

export function markMarketingReady(): void {
  markReady();
}

export function whenMarketingReady(): Promise<void> {
  return ready;
}
