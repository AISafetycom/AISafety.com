// The rules behind `npm run check:styles` (the runner is check-styles.mjs; the
// rules themselves are Melissa's, in docs/css-guidelines.md).
//
// Everything here is text in, findings out: no file or git access, so each
// rule has a unit test in style-rules.test.mjs. To add a rule, add it to RULES,
// return findings for it from checkCss or checkTsx, and add a test.

// ── What is checked, and what is exempt ───────────────────────────────────

/** The design system itself. Never checked against its own rules. */
export const GLOBALS = 'src/app/globals.css'

/** Admin-only code, exempt entirely: the rules cover what visitors see. Every
    admin-only component lives in one of these folders today; if one is ever
    kept somewhere else, add its path here. */
export const EXEMPT = ['src/app/admin/', 'src/lib/admin/']

/** Where buttons are styled on purpose. Every other file uses <Button>. */
export const BUTTON_FILES = [
  'src/components/Button.tsx',
  'src/components/Button.module.css',
]

/** The site's one breakpoint: `max-width: 991px` (and its other side,
    `min-width: 992px`). */
const BREAKPOINT_MAX = 991
const BREAKPOINT_MIN = 992

/** `error` fails the check. `warn` is printed as a note and never fails. */
export const RULES = {
  'hard-coded-color': { level: 'error', title: 'Hard-coded color' },
  'new-variable': { level: 'error', title: 'New CSS variable' },
  font: { level: 'error', title: 'Hand-written font styling' },
  'box-shadow': { level: 'error', title: 'Custom box-shadow' },
  breakpoint: { level: 'error', title: 'Extra breakpoint' },
  // Only for a class that is new to its file. A class that was already there
  // can start to match a utility without anyone adding anything (a variable
  // gets renamed, a utility is added to globals.css), and that is clean-up,
  // not a new mistake.
  'duplicate-class': {
    level: 'error',
    title: 'Class that only repeats globals.css',
    newClassesOnly: true,
  },
  'inline-style': { level: 'error', title: 'Inline style' },
  'styled-button': { level: 'error', title: 'Hand-styled button' },
  // Spacing, flex and gap written by hand are notes, not failures: a class
  // that genuinely needs its own CSS (a component's shape, a hover state)
  // often has one of these lines in it, Button.module.css included. A class
  // made of nothing else is a `duplicate-class` error instead.
  'utility-available': {
    level: 'warn',
    title: 'A utility class already does this',
  },
  'raw-button': { level: 'warn', title: 'New <button> element' },
  'design-system-variable': {
    level: 'warn',
    title: 'New variable in globals.css',
  },
  // An "allow" comment (see docs/css-guidelines.md). Listed so reviewers see
  // every new one; never fails by itself.
  exception: { level: 'warn', title: 'Exception added' },
}

export function inScope(path) {
  if (!path.startsWith('src/')) return false
  if (path === GLOBALS) return false
  if (EXEMPT.some(dir => path.startsWith(dir))) return false
  if (path.endsWith('.test.tsx')) return false
  return path.endsWith('.css') || path.endsWith('.tsx')
}

// ── A small CSS reader ────────────────────────────────────────────────────
// Enough CSS to list every block with its selector, its declarations and the
// @-rules around it, with line numbers. The site's CSS is plain CSS (no Sass),
// so this avoids adding a parser dependency.

export function parseCss(text) {
  const comments = []
  let clean = ''
  let line = 1
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      clean += c
      if (c === '\\' && i + 1 < text.length) {
        clean += text[++i]
        if (text[i] === '\n') line++
      } else if (c === quote || c === '\n') {
        if (c === '\n') line++
        quote = null
      }
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      const stop = close === -1 ? text.length : close + 2
      const startLine = line
      for (let j = i; j < stop; j++) {
        if (text[j] === '\n') {
          line++
          clean += '\n'
        } else clean += ' '
      }
      comments.push({
        line: startLine,
        endLine: line,
        text: text.slice(i + 2, close === -1 ? text.length : close),
      })
      i = stop - 1
      continue
    }
    if (c === '"' || c === "'") quote = c
    if (c === '\n') line++
    clean += c
  }

  const nodes = []
  const stack = []
  let buf = ''
  let bufLine = 0
  let paren = 0
  line = 1
  quote = null
  const flushDeclaration = () => {
    const t = buf.trim()
    const at = bufLine
    buf = ''
    bufLine = 0
    if (!t || t.startsWith('@')) return
    const colon = t.indexOf(':')
    const owner = stack[stack.length - 1]
    if (colon < 1 || !owner) return
    const prop = t.slice(0, colon).trim()
    owner.decls.push({
      prop: prop.startsWith('--') ? prop : prop.toLowerCase(),
      value: t
        .slice(colon + 1)
        .trim()
        .replace(/\s+/g, ' '),
      line: at,
    })
  }
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]
    if (c === '\n') line++
    if (quote) {
      buf += c
      if (c === '\\' && i + 1 < clean.length) {
        buf += clean[++i]
        if (clean[i] === '\n') line++
      } else if (c === quote || c === '\n') quote = null
      continue
    }
    if (c === '"' || c === "'") {
      if (!bufLine) bufLine = line
      quote = c
      buf += c
      continue
    }
    if (c === '(') paren++
    else if (c === ')') paren = Math.max(0, paren - 1)
    if (paren === 0 && c === '{') {
      const selector = buf.trim().replace(/\s+/g, ' ')
      const node = {
        selector,
        isAt: selector.startsWith('@'),
        line: bufLine || line,
        decls: [],
        at: stack.filter(n => n.isAt).map(n => n.selector),
        parents: stack.filter(n => !n.isAt).map(n => n.selector),
      }
      buf = ''
      bufLine = 0
      nodes.push(node)
      stack.push(node)
      continue
    }
    if (paren === 0 && c === '}') {
      flushDeclaration()
      stack.pop()
      continue
    }
    if (paren === 0 && c === ';') {
      flushDeclaration()
      continue
    }
    if (!bufLine && !/\s/.test(c)) bufLine = line
    buf += c
  }
  return { nodes, comments }
}

const PLAIN_CLASS = /^\.([A-Za-z_][\w-]*)$/

const normalize = value =>
  value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s*,\s*/g, ', ')
    .trim()

const declKey = d => `${d.prop}: ${normalize(d.value)}`
const signature = decls => decls.map(declKey).sort().join('; ')

// ── Reading the design system out of globals.css ──────────────────────────
// The check never hard-codes Melissa's classes or colors: it reads them from
// globals.css each run, so it follows the design system as she changes it.

const NAMED = { white: 'ffffff', black: '000000' }

function hex6(hex) {
  let h = hex.replace('#', '').toLowerCase()
  if (h.length === 3 || h.length === 4) h = [...h].map(ch => ch + ch).join('')
  const alpha = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : null
  return { hex: h.slice(0, 6), alpha }
}

export function readDesignSystem(globalsCss) {
  const { nodes } = parseCss(globalsCss)

  const variables = new Map()
  for (const n of nodes)
    if (n.selector === ':root')
      for (const d of n.decls)
        if (d.prop.startsWith('--')) variables.set(d.prop, d.value)

  // color value → the variables that hold it
  const colorVariables = new Map()
  for (const [name, raw] of variables) {
    let value = raw.toLowerCase()
    const alias = /^var\((--[\w-]+)\)$/.exec(value)
    if (alias) value = (variables.get(alias[1]) ?? '').toLowerCase()
    const hex = /^#[0-9a-f]{3,8}$/.test(value) ? hex6(value).hex : NAMED[value]
    if (!hex) continue
    colorVariables.set(hex, [...(colorVariables.get(hex) ?? []), name])
  }

  // Top-level `.class { … }` rules (not inside @media, no :hover and so on).
  const classes = new Map()
  for (const n of nodes) {
    if (n.isAt || n.at.length || n.parents.length) continue
    const m = PLAIN_CLASS.exec(n.selector)
    if (!m) continue
    classes.set(m[1], [...(classes.get(m[1]) ?? []), ...n.decls])
  }

  const utilities = new Map() // "prop: value" → classes that are just that line
  const bySignature = new Map() // every declaration of a class → class names
  const bundles = [] // classes with two or more declarations
  const textStyles = []
  const shadowClasses = []
  for (const [name, decls] of classes) {
    if (!decls.length) continue
    const sig = signature(decls)
    bySignature.set(sig, [...(bySignature.get(sig) ?? []), name])
    if (decls.length === 1) {
      const key = declKey(decls[0])
      utilities.set(key, [...(utilities.get(key) ?? []), name])
      if (decls[0].prop === 'box-shadow') shadowClasses.push(name)
    } else bundles.push({ name, keys: decls.map(declKey) })
    const size = decls.find(d => d.prop === 'font-size')?.value
    const weight = decls.find(d => d.prop === 'font-weight')?.value
    if (size || weight) textStyles.push({ name: `.${name}`, size, weight })
  }
  for (const n of nodes) {
    if (n.at.length || !/^(body|h1|h2|h3)$/.test(n.selector)) continue
    const size = n.decls.find(d => d.prop === 'font-size')?.value
    const weight = n.decls.find(d => d.prop === 'font-weight')?.value
    const name =
      n.selector === 'body' ? '<p> (default text)' : `<${n.selector}>`
    if (size) textStyles.push({ name, size, weight })
  }

  return {
    variables,
    colorVariables,
    utilities,
    bySignature,
    bundles,
    textStyles,
    shadowClasses,
    shadowVariables: [...variables.keys()].filter(v =>
      v.startsWith('--shadow')
    ),
  }
}

// ── Shared pieces of the rules ────────────────────────────────────────────

const COLOR_PATTERN =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\([^)]*\)/gi

/** Hard-coded colors in a CSS value (anything inside url(…) is not a color). */
function colorsIn(value) {
  const found = value.replace(/url\([^)]*\)/gi, '').match(COLOR_PATTERN) ?? []
  return [...new Set(found)]
}

function colorHint(color, ds) {
  let hex = null
  let alpha = null
  if (color.startsWith('#')) ({ hex, alpha } = hex6(color))
  else {
    const m = /^rgba?\(([^)]*)\)$/i.exec(color)
    const parts = m ? m[1].split(/[\s,/]+/).filter(Boolean) : []
    if (parts.length >= 3 && parts.slice(0, 3).every(p => /^\d+$/.test(p))) {
      hex = parts
        .slice(0, 3)
        .map(p => Number(p).toString(16).padStart(2, '0'))
        .join('')
      if (parts[3] !== undefined)
        alpha = parts[3].endsWith('%')
          ? parseFloat(parts[3]) / 100
          : parseFloat(parts[3])
    }
  }
  const names = hex ? ds.colorVariables.get(hex) : null
  if (!names)
    return `${color} is not a color in the palette. Pick a variable from the "Which color for what" table in docs/css-guidelines.md and write var(--…).`
  if (alpha === null || alpha >= 1)
    return `${color} is var(${names[0]}). Write var(${names[0]}) instead.`
  return `${color} is var(${names[0]}) at ${Math.round(alpha * 100)}%. Write color-mix(in srgb, var(${names[0]}) ${Math.round(alpha * 100)}%, transparent), as globals.css does.`
}

function fontHint(prop, value, ds) {
  if (prop.replace('-', '') === 'fontfamily' || prop === 'font')
    return 'The whole site uses one font, set once in globals.css. Delete this line.'
  const sizes = ds.textStyles
    .filter(t => t.size)
    .map(t => `${t.name} ${t.size}`)
    .join(', ')
  if (prop.replace('-', '') === 'fontsize') {
    const v = typeof value === 'string' ? normalize(value) : null
    const same = ds.textStyles.filter(t => t.size && t.size === v)
    if (same.length)
      return `Don't set font-size by hand. ${v} is ${same.map(t => t.name).join(' or ')}: put that on the element instead.`
    return `Don't set font-size by hand. Use one of the existing text styles on the element: ${sizes}.`
  }
  const bold = ds.textStyles
    .filter(t => t.name.endsWith('-bold'))
    .map(t => t.name)
    .join(', ')
  return `Don't set font-weight by hand. Text weight comes with the text class: the bold versions are ${bold}.`
}

function shadowHint(ds) {
  return `Use a shadow class on the element (${ds.shadowClasses.map(c => `.${c}`).join(', ')}). If the shadow only appears in a state such as :hover, use a shadow variable: ${ds.shadowVariables.map(v => `var(${v})`).join(', ')}.`
}

function shadowAllowed(value) {
  const v = normalize(value)
  if (/^(none|inherit|initial|unset|revert)$/.test(v)) return true
  return v.split(', ').every(part => /^var\(--shadow[\w-]*\)$/.test(part))
}

const BUTTON_HINT =
  'Buttons are never styled by hand. Use <Button> from src/components/Button.tsx (variant: white, teal, teal-alt, clear or clear-border; size: default or small; iconPosition="only" for an icon button). For a link that looks like a button: <Button as={Link} href="…">. If no variant fits, that is a design decision for Melissa, not a new class.'

const BUTTON_CLASS = /(?:button|btn)$/i
const BUTTON_IN_SELECTOR =
  /\.[\w-]*(?:button|btn)(?![\w-])|(?:^|[\s>+~,(])button(?![\w-])/i

// ── CSS rules ─────────────────────────────────────────────────────────────

/** Every class name a stylesheet mentions, as ".name". */
export function classesIn(text) {
  const names = new Set()
  for (const n of parseCss(text).nodes)
    if (!n.isAt)
      for (const m of n.selector.match(/\.[A-Za-z_][\w-]*/g) ?? []) names.add(m)
  return names
}

/** Findings for one stylesheet outside globals.css. `knownClasses` are the
    classes the file already had on main (see `duplicate-class` in RULES);
    leave it out to list everything. */
export function checkCss(text, ds, file = '', knownClasses = new Set()) {
  const { nodes, comments } = parseCss(text)
  const findings = []
  const add = (rule, line, what, hint, key) =>
    findings.push({ rule, line, what, hint, key: key ?? what })

  // Class names that appear in more than one block (a :hover rule, a mobile
  // override, a parent selector). Those can't simply be swapped for a utility
  // class in the markup, so `duplicate-class` leaves them alone.
  const uses = new Map()
  for (const n of nodes) {
    if (n.isAt) continue
    for (const m of new Set(n.selector.match(/\.[A-Za-z_][\w-]*/g) ?? []))
      uses.set(m, (uses.get(m) ?? 0) + 1)
  }

  for (const n of nodes) {
    // @media: one breakpoint only
    if (n.isAt && /^@media\b/i.test(n.selector)) {
      const widths = [
        ...n.selector.matchAll(
          /(max|min)-(?:device-)?width\s*:\s*([\d.]+)px/gi
        ),
      ].map(m => [m[1].toLowerCase(), Number(m[2])])
      const ranged = [
        ...n.selector.matchAll(/width\s*[<>]=?\s*([\d.]+)px/gi),
        ...n.selector.matchAll(/([\d.]+)px\s*[<>]=?\s*width/gi),
      ].map(m => Number(m[1]))
      const usesEmWidth = /(?:width)\s*[:<>]=?\s*[\d.]+(?:em|rem)/i.test(
        n.selector
      )
      const off =
        usesEmWidth ||
        widths.some(
          ([side, px]) =>
            px !== (side === 'max' ? BREAKPOINT_MAX : BREAKPOINT_MIN)
        ) ||
        ranged.some(px => px !== BREAKPOINT_MAX && px !== BREAKPOINT_MIN)
      if (off)
        add(
          'breakpoint',
          n.line,
          n.selector,
          `The site has one breakpoint: @media (max-width: ${BREAKPOINT_MAX}px). globals.css already handles most mobile changes at that width, so check whether an override is needed at all.`
        )
    }

    const where = n.isAt ? n.selector : [...n.at, n.selector].join(' ')

    // Buttons: a class named like a button, or a `button` element selector.
    // :global(…) names another library's classes (the map's own controls),
    // which the site doesn't get to rename.
    if (
      !n.isAt &&
      !BUTTON_FILES.includes(file) &&
      BUTTON_IN_SELECTOR.test(n.selector.replace(/:global\([^)]*\)/g, ''))
    )
      add('styled-button', n.line, n.selector, BUTTON_HINT, where)

    const failed = new Set() // lines already reported as a failure
    for (const d of n.decls) {
      const shown = `${d.prop}: ${d.value}`
      const key = `${where} { ${declKey(d)} }`
      if (d.prop.startsWith('--')) {
        add(
          'new-variable',
          d.line,
          shown,
          'Variables live only in globals.css, and only Melissa adds them. Use one that already exists.',
          key
        )
        continue
      }
      // A hand-written shadow is reported once, as a shadow, not also for
      // the color inside it.
      const customShadow = d.prop === 'box-shadow' && !shadowAllowed(d.value)
      const colors = customShadow ? [] : colorsIn(d.value)
      if (colors.length) {
        failed.add(d)
        add(
          'hard-coded-color',
          d.line,
          shown,
          colors.map(c => colorHint(c, ds)).join(' '),
          key
        )
      }
      if (
        ['font-size', 'font-weight', 'font-family', 'font'].includes(d.prop) &&
        normalize(d.value) !== 'inherit'
      ) {
        failed.add(d)
        add('font', d.line, shown, fontHint(d.prop, d.value, ds), key)
      }
      if (customShadow) {
        failed.add(d)
        add('box-shadow', d.line, shown, shadowHint(ds), key)
      }
    }

    // A plain `.class { … }` rule at the top level, compared with globals.css
    const plain =
      !n.isAt && !n.at.length && !n.parents.length && n.decls.length
        ? PLAIN_CLASS.exec(n.selector)
        : null
    if (!plain) continue
    const standsAlone =
      uses.get(n.selector) === 1 && !knownClasses.has(n.selector)
    const copyOf = ds.bySignature.get(signature(n.decls))
    const asUtilities = n.decls.map(d => ds.utilities.get(declKey(d))?.[0])
    if (standsAlone && copyOf) {
      add(
        'duplicate-class',
        n.line,
        `${n.selector} is an exact copy of .${copyOf[0]}`,
        `Delete ${n.selector} and put "${copyOf[0]}" in the element's className instead.`,
        `${n.selector} { ${signature(n.decls)} }`
      )
      continue
    }
    if (standsAlone && asUtilities.every(Boolean)) {
      add(
        'duplicate-class',
        n.line,
        `${n.selector} only repeats utility classes`,
        `Delete ${n.selector} and write className="${asUtilities.join(' ')}" on the element instead.`,
        `${n.selector} { ${signature(n.decls)} }`
      )
      continue
    }
    // Notes: single lines a utility already covers, and rebuilt bundles
    const keys = new Set(n.decls.map(declKey))
    const rebuilt = ds.bundles.filter(b => b.keys.every(k => keys.has(k)))
    for (const b of rebuilt)
      add(
        'utility-available',
        n.line,
        `${n.selector} contains everything in .${b.name}`,
        `Put "${b.name}" in the className and keep only the lines that are extra.`,
        `${n.selector} ⊇ .${b.name}`
      )
    const covered = new Set(rebuilt.flatMap(b => b.keys))
    n.decls.forEach((d, i) => {
      if (!asUtilities[i] || covered.has(declKey(d)) || failed.has(d)) return
      add(
        'utility-available',
        d.line,
        `${d.prop}: ${d.value}`,
        `There is a utility class for this: "${asUtilities[i]}". Put it in the className unless this class needs the line for another reason (a state, a mobile override).`,
        `${n.selector} { ${declKey(d)} }`
      )
    })
  }

  return applyAllows(findings, cssAllows(comments))
}

/** Notes for a change to globals.css itself: new variables only. */
export function checkGlobals(text) {
  const findings = []
  for (const n of parseCss(text).nodes)
    for (const d of n.decls)
      if (d.prop.startsWith('--'))
        findings.push({
          rule: 'design-system-variable',
          line: d.line,
          what: d.prop,
          hint: 'Only Melissa adds variables to the design system. Check that she asked for this one.',
          key: `${n.selector} ${d.prop}`,
        })
  return findings
}

// ── TSX rules ─────────────────────────────────────────────────────────────

const FONT_KEYS = ['fontSize', 'fontWeight', 'fontFamily', 'font']

/** Findings for one .tsx file. `ts` is the `typescript` package. */
export function checkTsx(text, ds, ts, file = '') {
  const sf = ts.createSourceFile(
    file || 'file.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const findings = []
  const lineOf = node =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const add = (rule, node, what, hint, key) =>
    findings.push({ rule, line: lineOf(node), what, hint, key: key ?? what })

  // Link-preview images (next/og) are drawn outside the page, where classes
  // and variables don't exist, so inline styles are the only way there.
  const drawsImage = /from\s+['"]next\/og['"]/.test(text)

  const cssModules = new Set() // names bound to an imported *.module.css
  const objects = new Map() // const name → its object literal
  const walk = (node, visit) => {
    visit(node)
    ts.forEachChild(node, child => walk(child, visit))
  }
  walk(sf, node => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.endsWith('.module.css') &&
      node.importClause?.name
    )
      cssModules.add(node.importClause.name.text)
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      !objects.has(node.name.text)
    )
      objects.set(node.name.text, node.initializer)
  })

  // Every object literal a style={…} can resolve to in this file
  const styleObjects = (expr, seen = new Set()) => {
    if (!expr || seen.has(expr)) return []
    seen.add(expr)
    if (
      ts.isParenthesizedExpression(expr) ||
      ts.isAsExpression(expr) ||
      ts.isSatisfiesExpression(expr)
    )
      return styleObjects(expr.expression, seen)
    if (ts.isConditionalExpression(expr))
      return [
        ...styleObjects(expr.whenTrue, seen),
        ...styleObjects(expr.whenFalse, seen),
      ]
    if (ts.isBinaryExpression(expr))
      return [
        ...styleObjects(expr.left, seen),
        ...styleObjects(expr.right, seen),
      ]
    if (ts.isIdentifier(expr)) return styleObjects(objects.get(expr.text), seen)
    if (ts.isObjectLiteralExpression(expr))
      return [
        expr,
        ...expr.properties
          .filter(ts.isSpreadAssignment)
          .flatMap(s => styleObjects(s.expression, seen)),
      ]
    return []
  }

  const literalTexts = node => {
    const out = []
    walk(node, n => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
        out.push(n.text)
      else if (ts.isTemplateExpression(n)) out.push(n.getText(sf))
    })
    return out
  }

  const reported = new Set()
  const checkStyle = attr => {
    const expr =
      attr.initializer && ts.isJsxExpression(attr.initializer)
        ? attr.initializer.expression
        : null
    for (const obj of styleObjects(expr)) {
      for (const p of obj.properties) {
        if (reported.has(p.pos)) continue
        const named =
          (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
          (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
        if (!named) continue
        const name = p.name.text
        const value = ts.isPropertyAssignment(p) ? p.initializer : p.name
        const shown = `style={{ ${p.getText(sf).replace(/\s+/g, ' ')} }}`
        if (FONT_KEYS.includes(name)) {
          reported.add(p.pos)
          const literal = literalTexts(value)[0]
          add(
            'inline-style',
            p,
            shown,
            fontHint(name.toLowerCase(), literal, ds)
          )
          continue
        }
        const texts = literalTexts(value)
        const colors = texts.flatMap(colorsIn)
        if (colors.length) {
          reported.add(p.pos)
          add(
            'inline-style',
            p,
            shown,
            `${colors.map(c => colorHint(c, ds)).join(' ')} For text, a class such as "color-teal-300" on the element is better still.`
          )
        } else if (
          name === 'boxShadow' &&
          texts.length &&
          !texts.every(shadowAllowed)
        ) {
          reported.add(p.pos)
          add('inline-style', p, shown, shadowHint(ds))
        }
      }
    }
  }

  const classNames = attr => {
    const out = []
    const init = attr.initializer
    if (!init) return out
    const visit = n => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
        // `kind === 'button'` compares a value, it isn't a class name
        const p = n.parent
        const compared =
          p &&
          ts.isBinaryExpression(p) &&
          [
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
            ts.SyntaxKind.EqualsEqualsToken,
            ts.SyntaxKind.ExclamationEqualsToken,
          ].includes(p.operatorToken.kind)
        if (!compared) out.push(...n.text.split(/\s+/))
        return
      }
      if (ts.isTemplateExpression(n)) {
        out.push(...n.head.text.split(/\s+/))
        for (const span of n.templateSpans) {
          visit(span.expression)
          out.push(...span.literal.text.split(/\s+/))
        }
        return
      }
      const fromModule =
        (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) &&
        ts.isIdentifier(n.expression) &&
        cssModules.has(n.expression.text)
      if (fromModule && ts.isPropertyAccessExpression(n)) {
        out.push(n.name.text)
        return
      }
      if (fromModule && ts.isStringLiteralLike(n.argumentExpression)) {
        out.push(n.argumentExpression.text)
        return
      }
      ts.forEachChild(n, visit)
    }
    visit(init)
    return out.filter(Boolean)
  }

  walk(sf, node => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))
      return
    const tag = node.tagName.getText(sf)
    const attrs = node.attributes.properties.filter(ts.isJsxAttribute)
    const attr = name => attrs.find(a => a.name.getText(sf) === name)

    if (attr('style') && !drawsImage) checkStyle(attr('style'))

    if (BUTTON_FILES.includes(file) || tag === 'Button') return
    const classAttr = attr('className')
    if (!classAttr) return
    const buttonish = classNames(classAttr).filter(c => BUTTON_CLASS.test(c))
    if (buttonish.length)
      add(
        'styled-button',
        node,
        `<${tag} className="${buttonish.join(' ')}">`,
        BUTTON_HINT
      )
    else if (tag === 'button')
      add(
        'raw-button',
        node,
        `<button className=${classAttr.initializer?.getText(sf).replace(/\s+/g, ' ') ?? ''}>`,
        'If this should look like a button, use <Button> (src/components/Button.tsx) instead of styling one. A chip, tab or row that <Button> does not cover is fine.',
        `<button> ${classNames(classAttr).join(' ')}`
      )
  })

  return applyAllows(findings, tsxAllows(text))
}

// ── Exceptions ────────────────────────────────────────────────────────────
// A comment on the line above (or the same line):
//     /* style-check: allow box-shadow (focus ring, agreed with Melissa) */
// turns that one finding into a listed exception. It needs the rule's name and
// a reason; without a reason it does nothing.

const ALLOW = /style-check:\s*allow\s+([a-z-]+)[\s:(—–-]*([^*)]*)/i

function cssAllows(comments) {
  const allows = []
  for (const c of comments) {
    const m = ALLOW.exec(c.text)
    if (m) allows.push({ rule: m[1], reason: m[2].trim(), line: c.endLine })
  }
  return allows
}

function tsxAllows(text) {
  const allows = []
  text.split('\n').forEach((source, i) => {
    const m = ALLOW.exec(source)
    if (m) allows.push({ rule: m[1], reason: m[2].trim(), line: i + 1 })
  })
  return allows
}

function applyAllows(findings, allows) {
  if (!allows.length) return findings
  return findings.map(f => {
    const allow = allows.find(
      a => a.rule === f.rule && (a.line === f.line || a.line + 1 === f.line)
    )
    if (!allow) return f
    if (allow.reason.length < 5)
      return {
        ...f,
        hint: `${f.hint} (The "style-check: allow" comment here has no reason, so it does nothing.)`,
      }
    return {
      rule: 'exception',
      line: f.line,
      what: `${RULES[f.rule].title}: ${f.what}`,
      hint: `Allowed by a comment: "${allow.reason}". Exceptions need Melissa's ok.`,
      key: `${f.rule} ${f.key}`,
    }
  })
}

// ── Old against new ───────────────────────────────────────────────────────

/** What a change added to one file. A rule is only reported when the file has
    MORE findings of that kind than before, so everything that was already
    there (and anything merely moved or reworded within the file) passes. */
export function added(before, after) {
  const out = []
  for (const rule of Object.keys(RULES)) {
    const old = RULES[rule].newClassesOnly
      ? []
      : before.filter(f => f.rule === rule)
    const now = after.filter(f => f.rule === rule)
    if (now.length <= old.length) continue
    const seen = new Map()
    for (const f of old) seen.set(f.key, (seen.get(f.key) ?? 0) + 1)
    const fresh = now.filter(f => {
      const left = seen.get(f.key) ?? 0
      if (left > 0) seen.set(f.key, left - 1)
      return left === 0
    })
    for (const f of fresh) out.push({ ...f, was: old.length, now: now.length })
  }
  return out.sort((a, b) => a.line - b.line)
}

/** Everything a change added to one file: its text on main ('' for a new
    file) against its text now. `ts` is the `typescript` package, needed for
    .tsx files only. */
export function addedTo(path, oldText, newText, ds, ts) {
  if (path === GLOBALS)
    return added(oldText ? checkGlobals(oldText) : [], checkGlobals(newText))
  if (path.endsWith('.css'))
    return added(
      oldText ? checkCss(oldText, ds, path) : [],
      checkCss(newText, ds, path, classesIn(oldText))
    )
  return added(
    oldText ? checkTsx(oldText, ds, ts, path) : [],
    checkTsx(newText, ds, ts, path)
  )
}
