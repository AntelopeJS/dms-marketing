import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../i18n/locales/marketing-en-GB.json'
import fr from '../i18n/locales/marketing-fr-FR.json'

// vitest runs with the frontend module as its root; the backend sits one level
// above it.
const BACKEND_SOURCE_DIR = join(process.cwd(), '..', 'src')

// `$page.marketing.a.b` as the backend writes it. A literal that stops on a
// dot is the prefix of a key completed by a template expression; those are
// resolved at runtime and cannot be checked here.
const KEY_LITERAL = /\$page\.marketing\.[\w.]+/g
const DYNAMIC_KEY_SUFFIX = '.'

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) {
    return [prefix]
  }
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  )
}

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return typescriptFiles(path)
    }
    return entry.isFile() && path.endsWith('.ts') ? [path] : []
  })
}

function backendKeys(): string[] {
  const found = new Set<string>()
  for (const file of typescriptFiles(BACKEND_SOURCE_DIR)) {
    for (const literal of readFileSync(file, 'utf8').match(KEY_LITERAL) ?? []) {
      const key = literal.slice(1)
      if (!key.endsWith(DYNAMIC_KEY_SUFFIX)) {
        found.add(key)
      }
    }
  }
  return [...found].sort()
}

function resolveKey(root: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      root,
    )
}

describe('locales', () => {
  it('carry the same key set', () => {
    expect(keysOf(fr).sort()).toEqual(keysOf(en).sort())
  })

  it('cover every namespace the surfaces use', () => {
    for (const namespace of [
      'overview',
      'pages',
      'campaigns',
      'funnels',
      'settings',
      'websites',
      'errors',
    ]) {
      expect(en.page.marketing).toHaveProperty(namespace)
    }
  })

  it('resolve every static key the backend emits', () => {
    const keys = backendKeys()
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.filter((key) => typeof resolveKey(en, key) !== 'string')).toEqual([])
    expect(keys.filter((key) => typeof resolveKey(fr, key) !== 'string')).toEqual([])
  })
})
