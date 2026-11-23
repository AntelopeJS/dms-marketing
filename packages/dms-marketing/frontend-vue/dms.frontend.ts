import { defineAsyncComponent, type Component } from 'vue'
import type { DmsFrontendModule } from '#dms/frontend-module'
import { dashboardTrackingPlugin } from './app/plugins/dashboard-tracking.client'
import funnelStepsDataType from './app/plugins/funnel-steps-data-type.client'
import { dashboardTrackingOptions } from './app/utils/dashboard-tracker'

interface VueModule {
  default: Component
}

/**
 * Every component of this module is addressed by name from the backend: the
 * pages declare `CustomComponent('DmsMarketing<Name>')` and the DataTypes
 * resolve their inputs the same way. Registering the whole directory behind
 * the module's prefix keeps the two sides in sync without a manual list.
 */
const components = import.meta.glob<VueModule>('./app/components/**/*.vue')

const frontendModule: DmsFrontendModule = {
  componentPrefix: 'DmsMarketing',
  setup(sdk) {
    const sorted = Object.entries(components).sort(([left], [right]) =>
      left.localeCompare(right),
    )
    for (const [path, loader] of sorted) {
      const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.vue$/, '')
      sdk.registerComponent(
        name,
        defineAsyncComponent(async () => (await loader()).default),
      )
    }
    sdk.registerPlugin(funnelStepsDataType, { clientOnly: true })
    const tracking = dashboardTrackingOptions(sdk.options.public)
    if (tracking) {
      sdk.registerPlugin(dashboardTrackingPlugin(tracking), {
        clientOnly: true,
      })
    }
  },
}

export default frontendModule
