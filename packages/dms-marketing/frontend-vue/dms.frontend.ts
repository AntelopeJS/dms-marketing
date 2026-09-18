import { defineAsyncComponent, type Component } from 'vue'
import type { DmsFrontendModule } from '#dms/frontend-module'
import funnelStepsDataType from './app/plugins/funnel-steps-data-type.client'

interface VueModule {
  default: Component
}

/**
 * Every component of this module is addressed by name from the backend: the
 * pages declare `CustomComponent('DmsMarketing<Name>')` and the DataTypes
 * resolve their inputs the same way. Registering the whole directory under
 * that prefix keeps the two sides in sync without a manual list.
 */
const components = import.meta.glob<VueModule>('./app/components/**/*.vue')

const frontendModule: DmsFrontendModule = {
  setup(sdk) {
    for (const [path, loader] of Object.entries(components).sort()) {
      const name = path
        .split('/')
        .at(-1)!
        .replace(/\.vue$/, '')
      sdk.registerComponent(
        `DmsMarketing${name}`,
        defineAsyncComponent(async () => (await loader()).default),
      )
    }
    // Client-only: the display it registers carries callables, which the SSR
    // payload strips.
    sdk.registerPlugin(funnelStepsDataType, { clientOnly: true })
  },
}

export default frontendModule
