// spec 008 V-8: the two message lists have the same keys, no empty value, the same {placeholders},
// and every key the code names exists. Same for the server's lists (server/messages.ts).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { browserLang, i18n, languageOf } from '../../src/i18n'
import { en } from '../../src/i18n/en'
import { ko } from '../../src/i18n/ko'
import { MESSAGES, MSG_KEYS, langFromHeader, text } from '../../server/messages'

function flatten(o: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (typeof v === 'string') out[prefix + k] = v
    else Object.assign(out, flatten(v, `${prefix}${k}.`))
  }
  return out
}
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()

const fko = flatten(ko)
const fen = flatten(en)

test('ko and en have the same keys', () => {
  assert.deepEqual(Object.keys(fen).sort(), Object.keys(fko).sort())
})

test('no value is empty', () => {
  for (const [k, v] of [...Object.entries(fko), ...Object.entries(fen)]) assert.ok(v.trim() !== '', k)
})

test('ko and en use the same {placeholders}', () => {
  for (const k of Object.keys(fko)) assert.deepEqual(vars(fen[k]!), vars(fko[k]!), k)
})

test('every message compiles (no vue-i18n syntax slipped in)', () => {
  for (const l of ['ko', 'en'] as const) for (const k of Object.keys(fko)) {
    const v = Object.fromEntries(vars(fko[k]!).map((n) => [n, `<${n}>`]))
    const want = (l === 'ko' ? fko : fen)[k]!.replace(/\{(\w+)\}/g, (_, n: string) => `<${n}>`)
    assert.equal(i18n.global.t(k, v, { locale: l }), want, `${l} ${k}`)
  }
})

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? sources(p) : /\.(vue|ts)$/.test(f) && !p.includes('/i18n/') ? [p] : []
  })
}

test('every key named in the screens exists', () => {
  const missing: string[] = []
  for (const file of sources('src')) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/(?<![\w.])(?:t|notReady)\(\s*'([\w.]+)'/g)) if (!(m[1]! in fko)) missing.push(`${file}: ${m[1]}`)
    // SettingsGeneral names its keys through g('x') = settings.general.x
    if (file.endsWith('SettingsGeneral.vue')) for (const m of src.matchAll(/(?<![\w.])g\(\s*'([\w.]+)'/g)) if (!(`settings.general.${m[1]}` in fko)) missing.push(`${file}: g(${m[1]})`)
  }
  assert.deepEqual(missing, [])
})

test('the server lists have the same keys and {placeholders}', () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ko).sort())
  for (const k of MSG_KEYS) {
    assert.ok(MESSAGES.en[k].trim() && MESSAGES.ko[k].trim(), k)
    assert.deepEqual(vars(MESSAGES.en[k]), vars(MESSAGES.ko[k]), k)
  }
})

test('the server picks the language from Accept-Language (unknown or missing: Korean)', () => {
  assert.equal(langFromHeader(undefined), 'ko')
  assert.equal(langFromHeader(''), 'ko')
  assert.equal(langFromHeader('en'), 'en')
  assert.equal(langFromHeader('en-US,en;q=0.9'), 'en')
  assert.equal(langFromHeader('fr-FR, en;q=0.8'), 'en')
  assert.equal(langFromHeader('ko-KR,ko;q=0.9,en;q=0.8'), 'ko')
  assert.equal(langFromHeader('en;q=0.5, ko;q=0.9'), 'ko')
  assert.equal(langFromHeader('fr, de'), 'ko')
  assert.equal(text('en', 'keyMax', { max: 10 }), 'You can create up to 10 keys.')
})

test('the screen language: the account first, else the browser (en… = English, else Korean)', () => {
  assert.equal(browserLang(['en-US', 'ko']), 'en')
  assert.equal(browserLang(['ko-KR', 'en']), 'ko')
  assert.equal(browserLang(['fr-FR']), 'ko')
  assert.equal(browserLang([]), 'ko')
  assert.equal(languageOf('en'), 'en')
  assert.equal(languageOf('ko'), 'ko')
})
