# Claude Code Development Notes

## Project Overview

This is the Next.js codebase behind aisafety.com (migrated from Webflow in 2026; the migration is finished). It follows modern React/TypeScript best practices. The codebase emphasizes maintainability and simplicity over premature optimization.

## Development Philosophy

### Keep It Simple

- **Avoid over-engineering** - Don't create separate files/abstractions for single-use items
- **Prefer collocation** - Keep related code together rather than spreading across multiple files
- **Question abstractions** - Only extract when there's genuine reuse across multiple files

### Code Quality Standards

- **ESLint + Prettier** for consistent formatting
- **TypeScript** for type safety with inference over explicit types
- **Husky pre-commit hooks** to catch issues early
- **Meaningful naming** over cryptic class names (replace WebFlow-generated names)

### Project Structure

```
src/
├── app/           # Next.js app router pages
├── components/    # Reusable UI components
├── lib/           # Utility functions and configurations
└── types/         # TypeScript type definitions (only when shared)
```

## Tech Stack Decisions

### Next.js 16 + TypeScript

- **App Router** for modern React patterns
- **TypeScript** with strict config for reliability
- **Inter font** for design system consistency

### Styling Approach

- **Diagnose before fixing** — when something looks wrong, find the root cause (e.g. a flex container forcing shrink) rather than layering on overrides or hacks; the right fix is usually fewer lines, not more
- **Take extra care with CSS** — clean, minimal CSS is a top priority; write as few lines as possible and always review `docs/css-guidelines.md` before writing styles
- **Constraint-based design system** — always use utility classes from `globals.css` first
- **CSS variables** for all colors — never hardcode hex values
- **Base HTML elements** (`h1`–`h3`, `p`) are pre-styled — don't write heading/typography CSS
- **Utility classes** for typography (`paragraph-small`, `paragraph-xs`), colors (`color-teal-300`), spacing (`padding-bottom-24px`, `margin-top-16px`), layout (`flex`, `gap-16px`, `width-6-col`, `container-default`), display (`hide-mobile`, `cursor-pointer`), and shadows (`drop-shadow`)
- **Pre-built components**: `.button-primary` / `.button-secondary` for buttons, `.text-field` / `.checkbox` for forms
- **New classes only when utility classes can't solve the problem** — put them in `ComponentName.module.css` (one component), `page.module.css` (one page), or rarely `globals.css` (truly reusable)
- **Never create one-off override classes** — if a component style needs adjusting for a common pattern (e.g. buttons with icons), fix it at the design system level in `globals.css` so all future instances work automatically
- **Media queries** are handled in `globals.css` — only write custom breakpoint styles for explicit overrides

### Dependency Management

- **package-lock.json** is critical - always commit
- **Node version pinning** via .nvmrc for team consistency
- **Minimal dependencies** - prefer built-in solutions when possible

## Lessons Learned

### WebFlow Migration Patterns

1. **Extract shared elements first** (navigation, background, layout)
2. **Keep complex CSS intact** - don't try to recreate WebFlow's intricate styles
3. **Replace simple utilities** with `globals.css` utility classes where beneficial
4. **Preserve exact colors** - use CSS variables, never hardcode hex values

### React/Next.js Best Practices

1. **Component composition over inheritance**
2. **Props destructuring** for cleaner interfaces
3. **Semantic HTML** with proper alt text for accessibility
4. **File-based routing** for predictable URL structure

### Development Workflow

1. **Lint early, lint often** - fix issues immediately
2. **Type safety** catches bugs before runtime
3. **Small, focused commits** with clear messages
4. **Test changes** locally before committing

### Tool Issues (Environment-Specific)

- **Grep tool failure**: If the Grep tool returns "No matches found" for patterns that clearly exist, use `grep` via Bash tool instead. This appears to be due to a missing ripgrep binary that fails silently. (Note: This may be specific to certain development environments and not apply to all users of this repository.)

## Project-Specific Patterns

### HTML Consistency

- **Use the same HTML tag for shared classes.** When a utility class like `button-primary` is used across the site, prefer using the same element type (e.g. always `<a>`/`<Link>`) to avoid browser-default style differences (borders, padding, etc.).

### CSS Details

- **Hover transitions:** All hover transitions use `var(--hover-transition)` defined in `:root` (`0.1s ease-in-out`). Never hardcode transition values.
- **Card hover color:** Uses `color-mix(in srgb, var(--teal-850) 60%, var(--teal-800))` — subtle shift using existing palette colors.
- **White button hover:** Darkens to `var(--off-white)` — never use opacity reduction.

### Key File Locations

- Design tokens & global classes: `src/app/globals.css`
- Communities map: `src/app/communities/CommunitiesMap.tsx`
- Communities page: `src/app/communities/page.tsx`
- Field map page: `src/app/map/page.tsx`

## Common Patterns

### Component Structure

```typescript
// Simple, focused components
interface Props {
  // Minimal, specific props
}

export default function Component({ prop }: Props) {
  // Local constants at top
  const localData = [...]

  return (
    // JSX with semantic HTML
  )
}
```

### Styling Approach

```typescript
// Use globals.css utility classes — only add custom classes when utilities can't solve it
<div className="flex items-center gap-16px padding-bottom-24px">
<p className="paragraph-small color-teal-300">Muted small text</p>
<a className="button-primary">Get Started</a>
```

### Type Safety

```typescript
// Prefer inference over explicit typing
const items = [...] // TypeScript infers the type
// Only add explicit types when sharing across files
```

## Future Considerations

### Scalability

- **Monitor bundle size** as features are added
- **Consider code splitting** for large pages only when needed
- **Performance optimization** should be measurement-driven, not premature

### Maintainability

- **Documentation** should focus on "why" not "what"
- **Consistent patterns** across similar components
- **Regular dependency updates** to avoid security issues

### Team Development

- **Onboarding docs** should emphasize the simplicity philosophy
- **Code reviews** should question complexity, not just correctness
- **Shared understanding** of when to extract vs. keep inline

---

_Remember: The best code is often the simplest code that solves the problem effectively._
