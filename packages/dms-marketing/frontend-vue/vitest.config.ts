import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      /**
       * Provided by the generated workspace at build time; stubbed here so the
       * module's own sources can be imported outside it.
       */
      '#dms/frontend-module': fileURLToPath(
        new URL('./tests/stubs/frontend-module.ts', import.meta.url),
      ),
    },
  },
  test: {
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.dom.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/**/*.dom.test.ts'],
        },
      },
    ],
  },
})
