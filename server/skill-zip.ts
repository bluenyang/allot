// One ZIP per skill for claude.ai (Customize › Skills › Upload, spec 015 S-14), made from the skills/ folder. Used by
// the server's download (spec 017 S-4, server/skills.ts) and by `node scripts/skills-zip.mjs`. Pure apart from reading
// the folder: a small ZIP writer (deflate, CRC-32) with node:zlib and a fixed date, so the same skills give the same bytes.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { deflateRawSync } from 'node:zlib'

/** A skill folder name: `allot-` and lowercase words (the folders in skills/). */
export const SKILL_NAME = /^allot-[a-z]+(?:-[a-z]+)*$/

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]))

/** A ZIP of `entries` ([name, bytes]) with a fixed date. */
export function zip(entries: readonly (readonly [string, Buffer])[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
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

/** The skill names in `root` (folders that hold a SKILL.md), sorted; none when the folder is missing. */
export function skillNames(root: string): string[] {
  try {
    return readdirSync(root)
      .filter((n) => SKILL_NAME.test(n))
      .filter((n) => { try { return statSync(join(root, n, 'SKILL.md')).isFile() } catch { return false } })
      .sort()
  } catch {
    return []
  }
}

/** The ZIP of one skill: its folder as `<name>/…`. */
export function skillZip(root: string, name: string): Buffer {
  const dir = join(root, name)
  return zip(files(dir).sort().map((f) => [`${name}/${relative(dir, f)}`, readFileSync(f)] as const))
}
