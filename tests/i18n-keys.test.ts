import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const I18N_FILE = 'src/i18n.tsx'

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      sourceFiles(path, acc)
    } else if (/\.tsx?$/.test(entry.name) && path !== I18N_FILE) {
      acc.push(path)
    }
  }
  return acc
}

/** Every key passed to `t('…')` in the app. */
function usedKeys(): Set<string> {
  const keys = new Set<string>()
  for (const file of sourceFiles('src')) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
      keys.add(match[1])
    }
  }
  return keys
}

function dictionaryKeys(block: string): Set<string> {
  return new Set([...block.matchAll(/^\s*'([a-zA-Z0-9_.]+)':/gm)].map((match) => match[1]))
}

function dictionaries(): { en: Set<string>; it: Set<string> } {
  const source = readFileSync(I18N_FILE, 'utf8')
  const enStart = source.indexOf('const en: Record<string, string> = {')
  const itStart = source.indexOf('const it: Record<string, string> = {')
  const tail = source.indexOf('const messages: Record')
  expect(enStart).toBeGreaterThan(0)
  expect(itStart).toBeGreaterThan(enStart)
  return {
    en: dictionaryKeys(source.slice(enStart, itStart)),
    it: dictionaryKeys(source.slice(itStart, tail)),
  }
}

describe('i18n dictionaries', () => {
  it('translate every key the app asks for', () => {
    const used = usedKeys()
    const { en, it } = dictionaries()
    expect(used.size).toBeGreaterThan(100)
    // A missing entry renders the raw key ("settings.threads") in the UI.
    expect([...used].filter((key) => !en.has(key))).toEqual([])
    expect([...used].filter((key) => !it.has(key))).toEqual([])
  })

  it('keep the two languages in step', () => {
    const { en, it } = dictionaries()
    expect([...en].filter((key) => !it.has(key))).toEqual([])
    expect([...it].filter((key) => !en.has(key))).toEqual([])
  })
})
