// Waits until a URL answers 2xx (up to 90 s). usage: node wait.mjs <url>
const url = process.argv[2]
if (!url) { console.log('usage: node wait.mjs <url>'); process.exit(2) }
for (let i = 0; i < 90; i++) {
  try {
    const r = await fetch(url)
    if (r.ok) { console.log(`healthy after ${i}s`); process.exit(0) }
  } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 1000))
}
console.log('not healthy after 90s')
process.exit(1)
