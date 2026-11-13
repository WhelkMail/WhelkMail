import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAIL_PRESETS, RELAY_PROVIDERS } from '../shared/presets'

// Preset labelKey/noteKey values are passed to t() as variables, which
// tests/i18n-keys.test.ts can't see (it only finds literal t('...') keys).
// Check them against both dictionaries here instead.
describe('preset translations', () => {
  it('has every preset label and note key in English and Italian', () => {
    const source = readFileSync('src/i18n.tsx', 'utf8')
    const en = source.slice(source.indexOf('const en:'), source.indexOf('const it:'))
    const itDict = source.slice(source.indexOf('const it:'), source.indexOf('const messages:'))
    const keys = [
      ...MAIL_PRESETS.flatMap((preset) => [preset.labelKey, preset.noteKey]),
      ...RELAY_PROVIDERS.map((provider) => provider.labelKey),
    ].filter((key): key is string => Boolean(key))
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(en, `English is missing ${key}`).toContain(`'${key}':`)
      expect(itDict, `Italian is missing ${key}`).toContain(`'${key}':`)
    }
  })
})
