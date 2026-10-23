import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The DMS builds the module's frontend with Vite alone, not Nuxt: Nuxt's
 * `import.meta.client` / `import.meta.server` are undefined there, so a branch
 * on them never runs in the browser (nor on the server). The context gate's
 * client-navigation wait was dead code that way. Vite's `import.meta.env.SSR`
 * is the flag both sides define. Checked on the sources themselves so a new
 * file cannot bring the Nuxt flags back.
 */

const APP = fileURLToPath(new URL('../app', import.meta.url))
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const NUXT_FLAG = /import\.meta\.(client|server|browser|dev|prerender)\b/

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return sources(path)
    }
    return /\.(vue|ts)$/.test(entry.name) ? [path] : []
  })
}

describe('build flags', () => {
  it('reads no Nuxt-only import.meta flag', () => {
    const files = [...sources(APP), join(ROOT, 'dms.frontend.ts')]
    const offending = files
      .filter((file) => NUXT_FLAG.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file).replaceAll('\\', '/'))
    expect(files.length).toBeGreaterThan(0)
    expect(offending).toEqual([])
  })
})
