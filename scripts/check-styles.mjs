#!/usr/bin/env node
// Guardrail: new styling on user-facing pages has to follow the design system
// (docs/css-guidelines.md). The rules are in style-rules.mjs; this file finds
// what changed and reports it.
//
// Only NEW styling is checked. Each changed file is compared with the same
// file on main, rule by rule: it fails when the file has MORE of something
// than it had there. So code that was already here passes untouched, a
// cleaned-up file tightens its own limit the moment it is merged, and there is
// no baseline file to keep up to date. /admin is exempt (see EXEMPT).
//
//   npm run check:styles                   this branch against main
//   npm run check:styles -- --base <ref>   against another commit
//   npm run check:styles -- --all          count everything that is already
//                                          there (a clean-up list; never fails)
//   npm run check:styles -- --all <file>   list every finding in those files
//   npm run check:styles -- --all --rule hard-coded-color   …or of one rule
//
// Also run by CI on every pull request, by the commit hook (--soft: if main
// can't be found, or a merge is under way, it says so and lets the commit
// through), and by Claude Code after it edits a .css or .tsx file (--hook,
// set up in .claude/settings.json).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import {
  GLOBALS,
  RULES,
  addedTo,
  checkCss,
  checkTsx,
  inScope,
  readDesignSystem,
} from './style-rules.mjs'

const args = process.argv.slice(2)
const has = name => args.includes(name)
const valueOf = name =>
  args.includes(name) ? args[args.indexOf(name) + 1] : null
const namedFiles = args.filter(
  (a, i) =>
    !a.startsWith('--') && !['--base', '--head', '--rule'].includes(args[i - 1])
)

function git(cwd, ...gitArgs) {
  return execFileSync('git', gitArgs, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  })
}
function tryGit(cwd, ...gitArgs) {
  try {
    return git(cwd, ...gitArgs)
  } catch {
    return null // the caller decides what a missing answer means
  }
}

/** The commit to compare with: where this branch left main. */
function findBase(root, head) {
  const asked = valueOf('--base') ?? process.env.STYLE_CHECK_BASE
  if (asked) {
    const sha = tryGit(
      root,
      'rev-parse',
      '--verify',
      '--quiet',
      `${asked}^{commit}`
    )
    if (!sha)
      throw new Error(`Can't find the commit "${asked}" to compare with.`)
    return sha.trim()
  }
  for (const main of ['origin/main', 'main']) {
    const sha = tryGit(root, 'merge-base', head ?? 'HEAD', main)
    if (sha) return sha.trim()
  }
  return null
}

/** Files that differ from the base: [{ path, old }], old = its path there. */
function changedFiles(root, base, head) {
  const files = []
  const diff = git(
    root,
    'diff',
    '--name-status',
    '-z',
    '-M',
    '--diff-filter=ACMR',
    base,
    ...(head ? [head] : []),
    '--',
    'src'
  )
    .split('\0')
    .filter(Boolean)
  for (let i = 0; i < diff.length; i++) {
    const status = diff[i][0]
    if (status === 'R' || status === 'C') {
      files.push({
        path: diff[i + 2],
        old: status === 'R' ? diff[i + 1] : null,
      })
      i += 2
    } else {
      files.push({
        path: diff[i + 1],
        old: status === 'A' ? null : diff[i + 1],
      })
      i += 1
    }
  }
  if (!head) {
    const untracked = git(
      root,
      'ls-files',
      '-z',
      '--others',
      '--exclude-standard',
      '--',
      'src'
    )
    for (const path of untracked.split('\0').filter(Boolean))
      files.push({ path, old: null })
  }
  return files
}

let typescript
async function loadTypescript() {
  typescript ??= (await import('typescript')).default
  return typescript
}

/** What a change added to one file (the rules need TypeScript for .tsx). */
async function addedToFile(path, oldText, newText, ds) {
  const ts = path.endsWith('.tsx') ? await loadTypescript() : null
  return addedTo(path, oldText, newText, ds, ts).map(f => ({ ...f, path }))
}

const checked = path => path === GLOBALS || inScope(path)

// ── Reporting ─────────────────────────────────────────────────────────────

function describe(f) {
  const count =
    f.was > 0 ? `  (this file had ${f.was} of these on main, now ${f.now})` : ''
  return `  ${f.path}:${f.line}  ${RULES[f.rule].title}: ${f.what}${count}\n      → ${f.hint}`
}

function report(fresh) {
  const errors = fresh.filter(f => RULES[f.rule].level === 'error')
  const notes = fresh.filter(f => RULES[f.rule].level !== 'error')
  const lines = []
  if (errors.length) {
    lines.push(
      `Style check FAILED: ${errors.length} new ${errors.length === 1 ? 'problem' : 'problems'} in user-facing code.`,
      '',
      ...errors.map(describe),
      '',
      'Only new styling is checked: each file is compared with main, and /admin is exempt.',
      'Fix these by reusing globals.css and the shared components, as each arrow says.',
      'The rules are in docs/css-guidelines.md.'
    )
  }
  if (notes.length) {
    if (errors.length) lines.push('')
    lines.push(
      `Notes (${notes.length}, these do not fail the check):`,
      '',
      ...notes.map(describe)
    )
  }
  return { errors, notes, text: lines.join('\n') }
}

/** In GitHub Actions, also mark each line in the pull request's Files tab. */
function annotate(fresh) {
  if (!process.env.GITHUB_ACTIONS) return
  const clean = s =>
    s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
  for (const f of fresh) {
    const kind =
      RULES[f.rule].level === 'error'
        ? 'error'
        : f.rule === 'exception'
          ? 'warning'
          : 'notice'
    const title = clean(RULES[f.rule].title).replace(/[,:]/g, ' ')
    console.log(
      `::${kind} file=${f.path},line=${f.line},title=${title}::${clean(`${f.what} → ${f.hint}`)}`
    )
  }
}

// ── The three ways to run it ──────────────────────────────────────────────

/** Compare what changed with main. Returns the exit code. */
async function compare(root) {
  const head = valueOf('--head')
  // Mid-merge, the folder holds other people's merged work as well, which is
  // not this commit's to answer for. CI checks the merged result.
  if (
    has('--soft') &&
    tryGit(root, 'rev-parse', '--verify', '--quiet', 'MERGE_HEAD')
  ) {
    console.log(
      'Style check: skipped while a merge is in progress; CI still runs it.'
    )
    return 0
  }
  const base = findBase(root, head)
  if (!base) {
    const message =
      "Style check: can't find the main branch to compare with (run `git fetch origin main`)."
    if (has('--soft')) {
      console.warn(`${message} Skipped here; CI still runs it.`)
      return 0
    }
    throw new Error(message)
  }
  const read = (ref, path) =>
    ref
      ? (tryGit(root, 'show', `${ref}:${path}`) ?? '')
      : readFileSync(join(root, path), 'utf8')

  let files = changedFiles(root, base, head).filter(f => checked(f.path))
  if (namedFiles.length) {
    const wanted = namedFiles.map(f =>
      relative(root, realpathSync(f)).split(sep).join('/')
    )
    files = files.filter(f => wanted.includes(f.path))
  }
  if (!files.length) {
    console.log('Style check passed: no user-facing styling changed.')
    return 0
  }

  // One design system for both sides (the new one), so a file's count only
  // moves when the file itself changes.
  const ds = readDesignSystem(read(head, GLOBALS))
  const fresh = []
  for (const f of files) {
    const oldText = f.old ? read(base, f.old) : ''
    fresh.push(...(await addedToFile(f.path, oldText, read(head, f.path), ds)))
  }

  const { errors, notes, text } = report(fresh)
  annotate(fresh)
  if (text) console.log(text)
  if (!errors.length)
    console.log(
      `${notes.length ? '\n' : ''}Style check passed: ${files.length} changed ${files.length === 1 ? 'file' : 'files'} checked against main, nothing new breaks the design system.`
    )
  return errors.length ? 1 : 0
}

/** Everything that is already there. A clean-up list; never fails. */
async function audit(root) {
  const ds = readDesignSystem(readFileSync(join(root, GLOBALS), 'utf8'))
  const tracked = git(
    root,
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    'src'
  )
  let files = tracked
    .split('\0')
    .filter(p => p && inScope(p) && existsSync(join(root, p)))
  const wanted = namedFiles.map(f =>
    relative(root, realpathSync(f)).split(sep).join('/')
  )
  if (wanted.length) files = files.filter(p => wanted.includes(p))

  const all = []
  for (const path of files) {
    const text = readFileSync(join(root, path), 'utf8')
    const found = path.endsWith('.css')
      ? checkCss(text, ds, path)
      : checkTsx(text, ds, await loadTypescript(), path)
    all.push(...found.map(f => ({ ...f, path, was: 0 })))
  }
  const rule = valueOf('--rule')
  if (rule && !RULES[rule])
    throw new Error(
      `No rule called "${rule}". The rules: ${Object.keys(RULES).join(', ')}.`
    )
  if (wanted.length || rule) {
    const listed = all.filter(f => !rule || f.rule === rule)
    console.log(listed.map(describe).join('\n') || 'Nothing found.')
    return 0
  }
  const tally = key => {
    const counts = new Map()
    for (const f of all) counts.set(key(f), (counts.get(key(f)) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])
  }
  console.log(
    `Already in user-facing code (${files.length} files; /admin is exempt):\n`
  )
  for (const [rule, n] of tally(f => f.rule))
    console.log(
      `  ${String(n).padStart(4)}  ${RULES[rule].title}${RULES[rule].level === 'error' ? '' : '  (note only)'}`
    )
  console.log('\nFiles with the most:\n')
  for (const [path, n] of tally(f => f.path).slice(0, 12))
    console.log(`  ${String(n).padStart(4)}  ${path}`)
  console.log('\nNone of this fails the check; only adding to it does.')
  console.log(
    'For the full list in one file: npm run check:styles -- --all <file>'
  )
  console.log(
    `For one rule everywhere: npm run check:styles -- --all --rule <${Object.keys(RULES).join(' | ')}>`
  )
  return 0
}

/** Claude Code hook (PostToolUse): the file Claude just edited, checked on the
    spot. Exit 2 hands the problems straight back to Claude to fix. */
async function hook() {
  const file = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.file_path
  if (typeof file !== 'string' || !/\.(css|tsx)$/.test(file)) return 0
  if (!existsSync(file)) return 0
  const real = realpathSync(file)
  const root = tryGit(dirname(real), 'rev-parse', '--show-toplevel')?.trim()
  if (!root) return 0
  const path = relative(realpathSync(root), real).split(sep).join('/')
  if (!checked(path) || !existsSync(join(root, GLOBALS))) return 0
  const base = findBase(root, null)
  if (!base) return 0

  const ds = readDesignSystem(readFileSync(join(root, GLOBALS), 'utf8'))
  const oldText = tryGit(root, 'show', `${base}:${path}`) ?? ''
  const fresh = await addedToFile(path, oldText, readFileSync(real, 'utf8'), ds)
  const { errors, notes, text } = report(fresh)
  if (errors.length) {
    console.error(text)
    return 2
  }
  if (notes.length)
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: text,
        },
      })
    )
  return 0
}

if (has('--hook')) {
  // The one place a failure of the check itself is swallowed on purpose: a
  // broken hook must never get in the way of an edit. The commit hook and CI
  // run the same check and do fail loudly.
  process.exitCode = await hook().catch(() => 0)
} else {
  try {
    const root = git(process.cwd(), 'rev-parse', '--show-toplevel').trim()
    process.exitCode = has('--all') ? await audit(root) : await compare(root)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
