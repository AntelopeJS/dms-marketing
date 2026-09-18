import type { Component } from 'vue'
import { resolveDmsComponent } from '#dms/frontend-module'

/**
 * A DMS core component addressed by name.
 *
 * The core frontend module registers its components before any other module's
 * entry runs, so a name that does not resolve is a programming error rather
 * than a state worth rendering around — and the callers hand the result to
 * APIs that take a component, not an optional one.
 */
export function dmsComponent(name: string): Component {
  const component = resolveDmsComponent(name)
  if (!component) {
    throw new Error(`Unknown DMS component: ${name}`)
  }
  return component
}
