import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // Provided by the generated workspace at build time; stubbed here so the
      // module's own sources can be imported outside it.
      '#dms/frontend-module': fileURLToPath(
        new URL('./tests/stubs/frontend-module.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
})
