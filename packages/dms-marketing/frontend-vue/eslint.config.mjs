import antiSlop from '@antelopejs/tooling-configs/oxc/anti-slop'
import guardrails from '@antelopejs/tooling-configs/oxc/guardrails'
import vue from 'eslint-plugin-vue'
import ts from 'typescript-eslint'

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

export default [
  { ignores: ['node_modules/**', 'dist/**'] },
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.ts', '**/*.vue'],
    languageOptions: { parserOptions: { parser: ts.parser } },
    rules: {
      curly: ['error', 'all'],
      'vue/multi-word-component-names': 'off',
    },
  },
  { files: ['**/*.ts'], languageOptions: { parser: ts.parser } },
  {
    files: ['app/**/*.ts', 'app/**/*.vue', 'dms.frontend.ts'],
    rules: { 'no-restricted-syntax': ['error', NUXT_ONLY_FLAG] },
  },
  {
    files: ['tests/**/*.ts'],
    plugins: { antelopejs: guardrails, 'anti-slop': antiSlop },
    rules: {
      'antelopejs/no-fs-read-in-tests': 'error',
      'antelopejs/no-constant-value-assertion': 'error',
      'antelopejs/no-self-import-in-tests': 'error',
      'anti-slop/no-module-mocking': 'error',
    },
  },
]
