# CSS Guidelines

This project uses a **constraint-based design system**. These rules ensure visual consistency and prevent arbitrary styling decisions. **Always use utility classes from `globals.css` first.** Only create new classes in rare cases when utility classes can't solve the problem. The most important part of this system is the file 'globals.css', which defines the styling for the entire site. Familiarize yourself with this file! Please read this walkthrough of the sections in that file.

## Walkthrough 'globals.css'

### 1. Variables

Always use a pre-defined variable for colors. Never hardcode hex, rgb, or rgba values. Never add new variables unless you are a designer, and check with Melissa.

There are two teal scales with the same steps (100 to 900, plus 750 and 850 at the dark end):

- `--teal-grey-*` is the neutral workhorse for text.
- `--teal-*` is the saturated teal scale for almost everything else: backgrounds, borders, accents, etc.

The darkest step is the same color in both (`--teal-900` is `--teal-grey-900`).

```css
/* Good */
background-color: var(--teal-850);
color: var(--teal-grey-300);

/* Bad */
background-color: #1c3334;
color: #a6dad9;
```

#### Which color for what

Pick by job, not by look. If a job isn't listed here, ask Melissa before adding a variable.

| Job                                      | Use                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Text**                                 |                                                                                           |
| Default: headings, body text, input text | `--white` (already set on `body` and `h1`–`h3`)                                           |
| Secondary text                           | `--teal-grey-300`                                                                         |
| Text highlights                          | `--teal-300`                                                                              |
| Links outside buttons                    | `--teal-300`, `--white`, or `--teal-grey-300`                                             |
| Error text                               | `--red-300`                                                                               |
| Inverse                                  | `--teal-900`                                                                              |
| **Backgrounds**                          |                                                                                           |
| Page background                          | `--teal-900` (set once on `body`)                                                         |
| Solid surface default                    | `--teal-850` (the `.card` class)                                                          |
| Solid surface light                      | `--white`                                                                                 |
| Gradient surface default                 | `--teal-800` fading to `--teal-850`                                                       |
| Gradient surface alt                     | `--teal-400` fading to `--teal-500`                                                       |
| **Lines**                                |                                                                                           |
| Border default and dividers default      | `--teal-800`                                                                              |
| Border alt and dividers alt              | `color-mix(in srgb, var(--teal-300) 30%, transparent)`                                    |
| Highlight                                | `--teal-300`                                                                              |
| **Accents**                              |                                                                                           |
| Tags                                     | `--orange-300`, `--pink-300`, `--green-300`, `--blue-300`, `--purple-300`, `--yellow-300` |

Each color above also has a text class: `.color-` plus the variable's name, for example `--teal-grey-300` is `.color-teal-grey-300`. In markup, color text with the class.

Some older styles still use `--teal-grey-*` for backgrounds and borders. Those are being moved to the teal scale.

### 2. CSS Reset

Ignore this section. Don't touch it.

### 3. Base Elements

Just use the HTML tags (`h1`, `h2`, `h3`) — they're already styled. Never write CSS for headings.

```tsx
// Good
<h1>Page Title</h1>
<h2>Section Title</h2>

// Bad
<h1 className="page-title">Page Title</h1>
```

### 4. Typography

Assign the relevant paragraph class to every p tag (other than the default, which is already styled). Never write CSS for typography.

```tsx
// Good
<p className="paragraph-small">Smaller text</p>
<p className="paragraph-xs">Extra small text</p>
<p>Default body text needs no class</p>

// Bad
.new-class {
  font-size: 16px;
  font-family: Inter;
  font-weight: 300;
}
```

### 5. Colors

Assign text colors using these utility classes.

```tsx
// Good
<p className="color-teal-grey-300">Muted text</p>
<span className="color-teal-300">Accent text</span>

// Bad
.new-class {
  color: var(--teal-300);
}
```

### 6. Spacing

Add padding and margin using these utility classes. Never write custom spacing.

```tsx
// Good
<div className="padding-bottom-24px margin-top-16px">

// Bad
.new-class {
  padding-bottom: 24px;
  margin-top: 16px;
}
```

### 7. Layout

Use these for flex, containers, gaps, and widths. Never write custom flexbox or width CSS.

```tsx
// Good
<div className="flex items-center gap-16px">
<div className="width-6-col">
<div className="container-default">

// Bad
.new-class {
  display: flex;
  align-items: center;
  gap: 16px;
}
.new-class {
  width: 500px;
}
```

### 8. Display

Use these for visibility, opacity, and cursor styles.

```tsx
// Good
<div className="hide-mobile">Desktop only</div>
<div className="cursor-pointer">

// Bad
.new-class-for-mobile {
  display:none;
}
.new-class {
  cursor: pointer;
}
```

### 9. Buttons

Never style a button. Use the `<Button>` component (`src/components/Button.tsx`). Its options use the same names as the Figma "Button" component:

- `variant`: `white` (the default), `teal`, `teal-alt`, `clear`, `clear-border`
- `size`: `default` (48px) or `small` (40px) for buttons with a label
- `icon` with `iconPosition`: `preceding`, `trailing` (the default) or `only`. Label buttons use a 16px icon.
- Icon-only buttons come in `small` (40px, the default, with a 24px icon) or `xs` (32px, with a 16px icon), never 48px. They need an `aria-label`, which also shows as a tooltip on hover and focus (not while disabled).

Hover, focus and disabled styles come for free. The text uses the global `.paragraph-small-bold` / `.paragraph-xs-bold` classes, so never set fonts on a button.

It renders a `<button>`. For a link that looks like a button, pass the link with `as`: `as={Link}` for pages on this site, `as="a"` for other sites, or a tracking wrapper like `as={TrackedLink}`.

```tsx
// Good
<Button type="submit">Subscribe</Button>
<Button as={Link} href="/events" icon="/images/icons/arrow-right.svg">View all events</Button>
<Button as="a" href="https://example.org" variant="clear-border">Learn more</Button>

// Bad
<a className="my-button">Get Started</a>
.my-button {
  [styling]
}
```

### 10. Forms

Use `.text-field` and `.checkbox` for form elements. Don't create custom input styles.

```tsx
// Good
<input type="text" className="text-field" />
<input type="checkbox" className="checkbox" />

// Bad
.new-class-with-text-field-styling {
  [styling]
}
.new-class-with-checkbox-styling {
  [styling]
}
```

### 11. Shadows

Use `.drop-shadow` classes. Never write custom box-shadow.

```tsx
// Good
<div className="drop-shadow">Card with shadow</div>
<div className="drop-shadow-light">Subtle shadow</div>

// Bad
<div style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
```

### 12. Layout Components

Page-level pieces like `.hero-bg`. You will likely not reference these, just let them hang out.

```tsx
// Good — just use it where needed
<div className="hero-bg">

// Bad — don't recreate it
.myHeroBackground {
  position: absolute;
  inset: 0% 0% auto 50%;
  /* ... */
}
```

### 13–14. Legacy

Old page-specific styles. Being cleaned up — don't add to these.

```css
/* Bad — don't add new styles to these sections */
.my-new-events-style { ... }

/* Good — put page-specific styles in page.module.css instead */
```

### 15. Media Queries

The site uses **one breakpoint: `991px`**. Do not introduce other breakpoints. `globals.css` already handles typography, spacing, grid, and flex changes at this breakpoint. Only write your own `@media (max-width: 991px)` if you need to override something specific to your page.

```css
/* Good — page-specific override at the single breakpoint */
@media (max-width: 991px) {
  .myComponent {
    width: 100%;
  }
}

/* Bad — don't use other breakpoints */
@media (max-width: 767px) { ... }
@media (max-width: 480px) { ... }

/* Bad — don't duplicate what globals.css already handles */
@media (max-width: 991px) {
  .width-6-col {
    width: 100%; /* already done in globals.css */
  }
}
```

## When to Create New Classes

Only create a new class when:

- You need component-specific styling that utility classes can't provide
- The styling involves complex selectors or pseudo-elements (if you don't know what this means, just ignore this line)

Where to put new classes:

- **Used in one component** → `ComponentName.module.css`
- **Used on one page** → `page.module.css`
- **Truly reusable utility** → `globals.css` (rare)
