/**
 * Stand-in for the loader-provided `#dms/frontend-module` alias.
 *
 * The real module only exists inside the Vue workspace the DMS frontend
 * loader generates; these tests run the module's own sources directly, so the
 * few SDK helpers they reach are stubbed with the same shapes.
 *
 * @packageDocumentation
 */
import type { Component } from 'vue'

export function defineDmsPlugin<Setup extends () => void | Promise<void>>(
  setup: Setup,
): Setup {
  return setup
}

export function useI18n() {
  return { t: (key: string) => key, te: () => false, locale: { value: 'en' } }
}

let routeQuery: Record<string, string> = {}

/** Sets the query `useDmsRoute` answers from now on, as a navigation would. */
export function setDmsRouteQuery(query: Record<string, string>): void {
  routeQuery = query
}

export function useDmsRoute() {
  return { query: routeQuery, path: '/' }
}

export function useDmsRouter() {
  return { replace: async () => {}, push: async () => {} }
}

export function useDmsRuntimeConfig() {
  return { public: { dms: { baseURL: '' } } }
}

export function resolveDmsComponent(): Component | undefined {
  return undefined
}

export function useDmsCookie<T>(_name: string, options: { default: () => T }) {
  return { value: options.default() }
}

export function useDmsUserSession() {
  return { loggedIn: { value: false }, session: { value: null } }
}
