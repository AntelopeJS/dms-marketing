import { antelopeNuxtConfig } from '@antelopejs/tooling-configs/eslint'

/**
 * Nuxt's `import.meta` flags. The DMS builds this module with Vite alone, where
 * they are undefined, so a branch on them never runs; `import.meta.env.SSR` is
 * the flag both sides define.
 */
const NUXT_ONLY_FLAG = {
  selector:
    "MemberExpression[object.type='MetaProperty'][object.meta.name='import'][object.property.name='meta'][property.name=/^(client|server|browser|dev|prerender)$/]",
  message:
    'The DMS builds this module with Vite, where Nuxt-only import.meta flags are undefined: use import.meta.env.SSR.',
}

export default antelopeNuxtConfig({
  typeAware: { tsconfigRootDir: import.meta.dirname },
  rules: { curly: ['error', 'all'] },
})
  .prepend({ ignores: ['.dms-types/**'] })
  .append({
    files: ['app/**/*.ts', 'app/**/*.vue', 'dms.frontend.ts'],
    rules: { 'no-restricted-syntax': ['error', NUXT_ONLY_FLAG] },
  })
