import { Logging } from "@antelopejs/interface-core/logging";
import { type CountryResponse, open, type Reader } from "maxmind";
import { getConfig } from "@/config";

let reader: Reader<CountryResponse> | undefined;

/**
 * Loads the configured country database once at start; beacons arriving
 * before the load resolves simply carry no country. No update watcher on
 * purpose — the file is deployment config like the path pointing at it, so
 * replacing it takes a restart rather than a poller holding the process open.
 */
export async function loadGeoipDatabase(): Promise<void> {
  const path = getConfig().geoipDatabasePath;
  if (!path) {
    return;
  }
  try {
    reader = await open<CountryResponse>(path);
  } catch (error) {
    Logging.Error(
      `[dms-marketing] GeoIP database unreadable (${path}):`,
      error,
    );
  }
}

/** Whether sessions are being stamped — lets the overview hide the countries
 * card on deployments that never configured a database, instead of showing a
 * map that stays empty forever. */
export function isGeoipActive(): boolean {
  return reader !== undefined;
}

/**
 * ISO 3166-1 alpha-2 code of the request IP, or undefined without a database
 * or a match (private ranges included). The IP is only ever read here, at
 * collect time — the country code is what gets stored, never the address.
 * The lookup must not throw: the IP can come from a client-forgeable
 * X-Forwarded-For and be arbitrary garbage.
 */
export function lookupCountry(ip: string): string | undefined {
  if (!reader) {
    return undefined;
  }
  let found: CountryResponse | null;
  try {
    found = reader.get(ip);
  } catch {
    return undefined;
  }
  return found?.country?.iso_code ?? found?.registered_country?.iso_code;
}
