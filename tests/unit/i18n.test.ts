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

test('keys built from data exist for every value (categories, kinds, states, tables…)', () => {
  const families: Record<string, string[]> = {
    'label.category': ['ai', 'telecom', 'content', 'tool', 'insurance', 'life'],
    'label.path': ['direct', 'google', 'apple', 'telecom'],
    'label.status': ['active', 'cancelled', 'company'],
    'label.cycle': ['monthly', 'yearly'],
    'label.eventKind': ['bank', 'sub', 'split', 'policy', 'tax', 'card', 'saving', 'income', 'loan', 'invest'],
    'label.allocDetail': ['living', 'subscriptions', 'fixed', 'remainder'],
    'label.allocKind': ['living', 'subscriptions', 'fixed', 'remainder'],
    'payroll.kind': ['living', 'subscriptions', 'fixed', 'remainder'],
    'timeline.state': ['todo', 'doing', 'done'],
    'subscriptions.filter': ['all', 'active', 'company', 'cancelled'],
    'settings.general.units': ['won', 'thousand', 'man'],
    'settings.general.shifts': ['before', 'after', 'none'],
    'settings.tabs': ['general', 'theme', 'ai', 'security'],
    'shell.pages': ['home', 'subs', 'pay', 'events', 'history', 'settings', 'admin', 'dev'],
    'calendar.kind': ['pay', 'transfer', 'billing', 'sub', 'change', 'holiday'],
    'history.table': ['settings', 'living', 'subscription', 'plan_change', 'phase', 'plan_event', 'check_item', 'bank_account', 'debt', 'allocation_target', 'phase_amount', 'remainder_split', 'preference', 'holiday_set'],
    'history.op': ['insert', 'update', 'delete'],
    'admin.admission': ['seed', 'admin', 'approval', 'rule', 'bootstrap'],
    'admin.signup': ['closed', 'approval', 'rules'],
    'settingsTheme.preset': ['green', 'teal', 'blue', 'navy', 'graphite', 'orange', 'amber', 'brick', 'purple'],
    'settingsTheme.radius': ['sharp', 'base', 'soft'],
    'settingsTheme.density': ['base', 'compact'],
    'common.weekday': ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
  }
  const missing = Object.entries(families).flatMap(([f, ids]) => ids.map((id) => `${f}.${id}`)).filter((k) => !(k in fko))
  assert.deepEqual(missing, [])
})

test('a zod issue without a message of ours is generic in the request language, never zod English (review finding 4)', async () => {
  const { z } = await import('zod')
  const { issueMessage } = await import('../../server/messages')
  const schema = z.object({
    n: z.number(), s: z.string().min(3), t: z.string().max(2), e: z.enum(['a', 'b']), u: z.string().email(), k: z.number().min(1, 'keyDaysMin'),
  }).strict()
  const cases: Array<[unknown, string]> = [
    [{ n: '90', s: 'abc', t: 'a', e: 'a', u: 'a@b.co', k: 1 }, 'invalidType'],
    [{ n: 1, s: 'a', t: 'a', e: 'a', u: 'a@b.co', k: 1 }, 'tooSmall'],
    [{ n: 1, s: 'abc', t: 'abc', e: 'a', u: 'a@b.co', k: 1 }, 'tooBig'],
    [{ n: 1, s: 'abc', t: 'a', e: 'z', u: 'a@b.co', k: 1 }, 'invalidValue'],
    [{ n: 1, s: 'abc', t: 'a', e: 'a', u: 'nope', k: 1 }, 'invalidFormat'],
    [{ n: 1, s: 'abc', t: 'a', e: 'a', u: 'a@b.co', k: 1, extra: 1 }, 'unknownField'],
  ]
  for (const [input, key] of cases) {
    const r = schema.safeParse(input)
    assert.equal(r.success, false)
    const issue = r.error!.issues[0]
    for (const lang of ['ko', 'en'] as const) {
      const got = issueMessage(lang, issue)
      assert.equal(got, text(lang, key as never), `${lang} ${issue?.code}`)
      assert.notEqual(got, issue?.message, 'zod\'s own text is not passed on')
    }
    assert.ok(!/[A-Za-z]{4,}/.test(issueMessage('ko', issue)), `Korean answer has no English words: ${issueMessage('ko', issue)}`)
  }
  // an explicit key is kept as it is
  const explicit = schema.safeParse({ n: 1, s: 'abc', t: 'a', e: 'a', u: 'a@b.co', k: 0 })
  assert.equal(issueMessage('en', explicit.error!.issues[0]), text('en', 'keyDaysMin'))
  assert.equal(issueMessage('ko', explicit.error!.issues[0]), text('ko', 'keyDaysMin'))
  // an issue with no known code falls back to the general message
  assert.equal(issueMessage('ko', { code: 'weird' }), text('ko', 'invalidInput'))
  assert.equal(issueMessage('en', undefined), text('en', 'invalidInput'))
})
