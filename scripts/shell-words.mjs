// Small shell parser shared by the PreToolUse guards (guard-review.mjs, guard-env.mjs).
//
// It splits a command line into simple commands ("segments") so a guard can look at command
// words instead of at every character of the text. Quoted text, heredoc bodies and comments are
// data: they never become the program of a segment. Command substitutions ($(...), backticks) are
// parsed as commands of their own, inside double quotes too, and the word that holds one carries
// the PH marker (as do ${...}, $name and ANSI-C $'...' quoting, whose value the parser cannot know).
//
// This is not a full shell: it covers what an agent writes by habit. Deliberate obfuscation
// (decoding a payload and piping it to a shell) is out of scope, as in the guards' threat model.

/** Marks, inside a word, text whose value is only known at run time. */
export const PH = '\u0001'

/**
 * Parses `src` into simple commands: `{ words, dyn, heredocs }` each, flattened (substitutions
 * included). `words` have their quotes removed; `dyn` is true when a word holds a PH marker;
 * `heredocs` are the bodies of the here-documents attached to the command.
 * `nlSpace`: a newline separates words instead of commands (the reading `gh<NL>pr<NL>merge`).
 */
export function parseShell(src, { nlSpace = false, body = false } = {}) {
  const s = String(src ?? '')
  const n = s.length
  const out = []
  let i = 0

  const skipBraces = () => {
    i += 2
    for (let depth = 1; i < n && depth > 0; i++) {
      if (s[i] === '$' && s[i + 1] === '(') { i += 2; run(')'); i-- } // a substitution inside ${...} still runs
      else if (s[i] === '`') { i++; run('`'); i-- }
      else if (s[i] === '{') depth++
      else if (s[i] === '}') depth--
    }
  }

  // substitutions in an unquoted here-document body still run; the rest of the body is data
  const scanBody = (text) => out.push(...parseShell(text, { nlSpace, body: true }))

  let nest = 0
  const run = (closer, asBody = false) => { // nesting is limited: deeper input is refused by the callers (they catch the error)
    if (++nest > 40) throw new Error("shell nesting too deep")
    try { runInner(closer, asBody) } finally { nest-- }
  }
  function runInner(closer, asBody) {
    let seg = null
    let word = null
    const pending = []
    const getSeg = () => (seg ??= { words: [], dyn: false, ansi: false, heredocs: [] })
    const endWord = () => { if (word !== null) { getSeg().words.push(word); word = null } }
    const endSeg = () => { endWord(); if (seg) { out.push(seg); seg = null } }
    const add = (t) => { word = (word ?? '') + t }
    const mark = () => { getSeg().dyn = true; add(PH) }

    const dq = (end = '"') => { // i is just after the opening quote (end: null = to the end of the text)
      add('')
      while (i < n && s[i] !== end) {
        const d = s[i]
        if (d === '\\') {
          const nx = s[i + 1]
          if (nx === '\n') { i += 2; continue }
          if (nx !== undefined && '"\\$`'.includes(nx)) { add(nx); i += 2; continue }
          add(d); i++; continue
        }
        if (d === '$' && s[i + 1] === '(') { i += 2; mark(); run(')'); continue }
        if (d === '`') { i++; mark(); run('`'); continue }
        if (d === '$' && s[i + 1] === '{') { mark(); skipBraces(); continue }
        if (d === '$' && /[A-Za-z_0-9@*#?!$-]/.test(s[i + 1] ?? '')) { mark(); i++; continue }
        add(d); i++
      }
      i++
    }

    if (asBody) { dq(null); return }

    while (i < n) {
      const c = s[i]
      if (closer && c === closer) { i++; endSeg(); return }
      if (c === "'") {
        const j = s.indexOf("'", i + 1)
        add('')
        if (j < 0) { add(s.slice(i + 1)); i = n } else { add(s.slice(i + 1, j)); i = j + 1 }
      } else if (c === '"') {
        i++; dq()
      } else if (c === '$' && s[i + 1] === "'") {
        i += 2; mark(); getSeg().ansi = true
        while (i < n && s[i] !== "'") i += s[i] === '\\' ? 2 : 1
        i++
      } else if (c === '$' && s[i + 1] === '"') {
        i += 2; mark(); getSeg().ansi = true; dq()
      } else if (c === '$' && s[i + 1] === '(') {
        i += 2; mark(); run(')')
      } else if (c === '$' && s[i + 1] === '{') {
        mark(); skipBraces()
      } else if (c === '$' && /[A-Za-z_0-9@*#?!$-]/.test(s[i + 1] ?? '')) {
        mark(); i++
      } else if (c === '`') {
        i++; mark(); run('`')
      } else if (c === '\\') {
        if (s[i + 1] === '\n') i += 2
        else { if (i + 1 < n) add(s[i + 1]); i += 2 }
      } else if (c === '#' && word === null) {
        while (i < n && s[i] !== '\n') i++
      } else if (c === '<' && s.startsWith('<<<', i)) {
        add('<<<'); i += 3
      } else if (c === '<' && s[i + 1] === '<') {
        endWord()
        i += 2
        const strip = s[i] === '-'
        if (strip) i++
        while (i < n && s[i] !== '\n' && /\s/.test(s[i])) i++
        let delim = ''
        let quoted = false
        while (i < n && !/[\s;&|()<>]/.test(s[i])) {
          if (s[i] === "'" || s[i] === '"') {
            quoted = true
            const j = s.indexOf(s[i], i + 1)
            const e = j < 0 ? n : j
            delim += s.slice(i + 1, e); i = e + 1
          } else if (s[i] === '\\') { quoted = true; delim += s[i + 1] ?? ''; i += 2 } else delim += s[i++]
        }
        pending.push({ seg: getSeg(), delim, quoted, strip })
      } else if (c === '\n') {
        if (nlSpace) endWord(); else endSeg()
        i++
        for (const h of pending) {
          let body = ''
          while (i < n) {
            let e = s.indexOf('\n', i)
            if (e < 0) e = n
            const line = s.slice(i, e)
            i = e + 1
            if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break
            body += `${line}\n`
          }
          h.seg.heredocs.push(body)
          if (!h.quoted) scanBody(body)
        }
        pending.length = 0
      } else if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')') {
        endSeg(); i++
      } else if (/\s/.test(c)) {
        endWord(); i++
      } else {
        add(c); i++
      }
    }
    endSeg()
  }

  run(null, body)
  return out
}


/** Program name of a word: the last path component. */
export const baseName = (w) => String(w ?? '').split('/').pop()
