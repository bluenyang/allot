// One ZIP per skill for claude.ai (Settings › Capabilities › Skills › Upload), spec 015 S-14: a plugin whose MCP
// address is a ${user_config} value brings no server to claude.ai, so the skills are uploaded on their own there.
//   node scripts/skills-zip.mjs        → dist-skills/<name>.zip (each holds <name>/SKILL.md; not committed)
// No dependency: a small ZIP writer (deflate, CRC-32) with node:zlib.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { deflateRawSync } from 'node:zlib'

const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'dist-skills')

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]))

/** A ZIP of `entries` ([name, Buffer]) with a fixed date, so the same skills give the same bytes. */
function zip(entries) {
  const local = []
  const central = []
  let offset = 0
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const packed = deflateRawSync(data)
    const crc = crc32(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8)
    head.writeUInt16LE(0, 10); head.writeUInt16LE(0x5a21, 12) // 2025-01-01 00:00
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(nameBuf.length, 26); head.writeUInt16LE(0, 28)
    local.push(head, nameBuf, packed)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10)
    cen.writeUInt16LE(0, 12); cen.writeUInt16LE(0x5a21, 14)
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42)
    central.push(cen, nameBuf)
    offset += head.length + nameBuf.length + packed.length
  }
  const cenBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, cenBuf, end])
}

mkdirSync(OUT, { recursive: true })
for (const name of readdirSync(join(ROOT, 'skills'))) {
  const dir = join(ROOT, 'skills', name)
  const entries = files(dir).sort().map((f) => [`${name}/${relative(dir, f)}`, readFileSync(f)])
  writeFileSync(join(OUT, `${name}.zip`), zip(entries))
  console.log(`dist-skills/${name}.zip (${entries.length} file${entries.length === 1 ? '' : 's'})`)
}
