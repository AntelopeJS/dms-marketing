import { defineDmsFrontendBuild } from '#dms/frontend-build'
import { backendBoundary } from './build/backend-boundary.ts'

/** The build of the frontend module: the backend boundary in every build. */
export default defineDmsFrontendBuild((build) => {
  build.registerVitePlugins(() => [backendBoundary()])
})
