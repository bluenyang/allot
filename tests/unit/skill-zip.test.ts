// spec 017 S-4, W-6: the skills download makes one ZIP per skills/ folder; only those names are served.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { test } from 'node:test'
import { SKILL_NAME, skillNames, skillZip } from '../../server/skill-zip'

const SKILLS = new URL('../../skills', import.meta.url).pathname

test('the names are the seven folders of skills/ (S-4)', () => {
  assert.deepEqual(skillNames(SKILLS), readdirSync(SKILLS).sort())
  assert.equal(skillNames(SKILLS).length, 7)
})

test('a ZIP holds <name>/SKILL.md, the same bytes each time', () => {
  const z = skillZip(SKILLS, 'allot-payday')
  assert.equal(z.subarray(0, 4).toString('latin1'), 'PK\u0003\u0004')
  const nameLen = z.readUInt16LE(26)
  assert.equal(z.subarray(30, 30 + nameLen).toString('utf8'), 'allot-payday/SKILL.md')
  const packed = z.readUInt32LE(18)
  const body = inflateRawSync(z.subarray(30 + nameLen, 30 + nameLen + packed)).toString('utf8')
  assert.match(body, /^---\nname: allot-payday\n/)
  assert.ok(skillZip(SKILLS, 'allot-payday').equals(z))
})

test('a name outside the pattern or a folder without SKILL.md is not listed; a missing folder lists none', () => {
  for (const bad of ['../etc', 'allot-', 'Allot-x', 'allot-x/../y', 'allot-x.zip', 'other']) assert.equal(SKILL_NAME.test(bad), false, bad)
  const dir = mkdtempSync(join(tmpdir(), 'allot-skills-'))
  try {
    mkdirSync(join(dir, 'allot-good'))
    writeFileSync(join(dir, 'allot-good', 'SKILL.md'), '---\nname: allot-good\n---\n')
    mkdirSync(join(dir, 'allot-empty'))
    mkdirSync(join(dir, 'notes'))
    writeFileSync(join(dir, 'notes', 'SKILL.md'), 'x')
    assert.deepEqual(skillNames(dir), ['allot-good'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  assert.deepEqual(skillNames(join(SKILLS, 'no-such-folder')), [])
})
