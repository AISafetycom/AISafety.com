# Design review checklist

Melissa's rules are in [`css-guidelines.md`](css-guidelines.md). `npm run check:styles` holds new code to the ones a script can judge. This list is the rest: the judgment rules a script can't check, written as short checks that can be made from the code. It comes before Melissa's own look at the page, not instead of it.

The list is hers to own. Each check comes from her guide, from the notes in `CLAUDE.md` and `docs/claude.md`, from her comments in the shared components, or from something a review caught. She can change or remove any line.

Every change to what visitors see gets an independent design review against this list before it is pushed (see [How a review runs](#how-a-review-runs)). The list grows by one line each time something slips through, so each mistake can happen only once (see [Adding to this list](#adding-to-this-list)).

The admin area (`src/app/admin/`, `src/lib/admin/`) is exempt, as it is from the guide.

## How a review runs

The reviewer is someone who did not write the change: a fresh Claude Code subagent that starts with no knowledge of the work, or a person. The session that wrote the code never reviews its own work, because it grades it kindly.

The reviewer:

1. Reads `docs/css-guidelines.md` and this file, both in full.
2. Runs `npm run check:styles` and reads all of its output. Its notes count too: each one is either a finding or explained.
3. Reads the whole diff against main (`git diff origin/main...HEAD`) and opens each changed file to see the changed lines in context. Where new markup looks like an existing component, opens that component as well.
4. Goes through every check below, one by one, against every added or changed line and every choice of element. Assume there are mistakes to find: the change has already passed the script and its author's own check.
5. Reports three lists:
   - **Findings.** A rule is broken. Each has the file and line, the check (its letter and number here, or the section of the guide), what is wrong, and the fix.
   - **Judgment calls for Melissa.** No rule settles it and only she can: a new size, a new component, a color for a job that isn't in the table.
   - **Changes to existing pages.** Everything that will look or behave differently on a page that already exists (check F1).

The reviewer changes no code. After the report, the author fixes each finding, and the change is reviewed again, or lists it in the pull request under "For design review (Melissa)" with the reason it stays. Judgment calls and changes to existing pages always go in that part of the pull request.

## The checks

### A. Components before new code

- **A1.** Before any new piece of UI, look in `src/components/` for one that already does the job (`Button`, `Icon`, `Tooltip`, `ListingCard`, `FeaturedCard`, `FilterBar`, `FilterDropdown`, `FilterPopover`, `PageHeader`, `StickyBar`, `SearchBar`, `SelectionMenu`, `NewsletterSignup`, `ModeToggle`, and the rest). New markup that does the job of an existing component is a finding.
- **A2.** A component that nearly fits gets a new prop. A copy of it, or a look-alike built beside it, is a finding.
- **A3.** No one-off overrides. New CSS that restyles a shared component from outside (a module class passed as its `className`, or a wrapper selector that reaches into it) is a finding. If the component looks wrong, its own file is fixed, so every use is fixed at once. Utility classes passed through a component's own `className` are fine: a `.color-*` class on `<Icon>`, a width class on `<FeaturedCard>`, a margin class on `<Button>`.
- **A4.** A brand-new component or `.module.css` file is a judgment call: list it, with why no existing component fits. A new shared component also gets a section on the `/design-system` page (`src/app/design-system/page.tsx`); without one it is a finding.
- **A5.** Every icon-only `<Button>` shows its label as a tooltip. `tooltip={false}` or an empty tooltip is a finding. A tooltip switched off by a condition is a judgment call: list it. (The script catches the plain cases. From the corrections pop-up, 22 November 2026.)
- **A6.** A button's `variant` and `size` come from the set in the guide, and icon-only buttons are `small` or `xs`. Nothing else is dressed up as a button: no `<div>`, `<span>`, or link given a button's border, fill, and padding. A chip, a tab, or a row that `<Button>` doesn't cover is fine.
- **A7.** Icons go through `<Icon>`, at 12, 16, 24, or 32px, from `/images/icons/`. An inline `<svg>` or an `<img>` used as an icon is a finding.
- **A8.** Form fields use `.text-field` (on `<input>`, `<select>`, and `<textarea>`) and `.checkbox`. A new class that restyles a field's border, colors, or type is a finding. Textareas are a gap: `.text-field` is a one-line box and the design system has no textarea style yet. A textarea's height is a judgment call: list it. Its padding is hand-written spacing like any other, so on a page it fails the style check unless it has an exception with Melissa's ok (B7).

### B. Utility classes before new CSS

- **B1.** Each new class is needed: it does something utility classes can't (a position, a size, a state, a pseudo-element, a complex selector). If utility classes on the element would do the same, the class goes.
- **B2.** Spacing and flex in new component CSS. The guide lets shared components set on-scale spacing and flex in their own CSS (Melissa, 21 November 2026), since they are the design system's own pieces. Whether that reaches a brand-new component is hers to say. So in a new component, or a new class in an existing one, each `padding`, `margin`, `gap`, or flex line that utility classes on the element would give is a judgment call: list it, or move it to the `className`, which is always fine. Lines where a class can't go (a state, a pseudo-element, a mobile override, a child selector) need no listing. (From the corrections pop-up, 22 November 2026.)
- **B3.** Sizes and positions (`width`, `height`, `max-width`, `border-radius`, `top`, `inset`, `z-index`) are not judged by the script. Each new value matches the same thing elsewhere: another component's radius, a column-width class, the Figma file. A number that appears nowhere else is a judgment call: list it.
- **B4.** One breakpoint, and only when needed. A `@media (max-width: 991px)` block that repeats what `globals.css` already does at that width (the spacing classes shrink, `.flex-col-mobile` stacks a row, the column widths go full) is a finding.
- **B5.** Nothing new goes in `globals.css` unless it is truly reusable, which is rare, and never a new variable. Any change there is listed for Melissa (F3).
- **B6.** No inline `style` where a class can do it. The script catches colors, fonts, spacing, and flex. The reviewer catches fixed sizes and positions. A value worked out while the page runs is fine.
- **B7.** Every new `style-check: allow` comment names Melissa's ok in its reason. Without that it is a finding. List each one either way.

### C. Elements and text

- **C1.** Headings are `<h1>` to `<h3>` and no new CSS styles them (the guide, section 3). Text that works as a heading is a heading element, not a bold `<p>` or a `<div>`. A heading that has to look smaller than its level takes a global paragraph class, as the footer's column headings do, and is a judgment call: list it.
- **C2.** Text sizes step down, never up: the text under a heading or label is not larger than it. Default `<p>` text is 17px. In a compact piece (a pop-up, a card, a menu, a form hint) it usually needs `paragraph-small` or `paragraph-xs`, like its neighbors. (From the corrections pop-up, 22 November 2026: a default `<p>` sat under a smaller heading.)
- **C3.** Every `<p>` that isn't default body text has a paragraph class, and no new CSS sets type. The script catches `font-size`, `font-weight`, and `font-family`. A new `line-height`, `letter-spacing`, or `text-transform` line is the reviewer's to catch.
- **C4.** One class, one kind of element, because browsers style `<a>`, `<button>`, `<div>`, and `<p>` differently. `docs/claude.md` ("HTML Consistency") asks for this for shared classes: putting a shared class that carries a look (`.card`, `.link`, `.text-field`, `.border-plus-fill`) on a kind of tag it isn't on yet is a judgment call: list it. The same goes for a file's own classes: a change that puts a class from a `.module.css` file on a second kind of tag is a finding. A class that was already on several tags is left alone, and plain utility classes (flex, spacing, paragraph, and color classes) go on any element. (The script adds a note for a module class on two HTML tags within one file, counting `<Link>` as `<a>`. Other components, a tag picked while the page runs, and other files that use the class are the reviewer's to check. From the corrections pop-up, 22 November 2026.)
- **C5.** The element fits the job: `<Button>` for an action, a link for going somewhere, `<ul>` and `<li>` for a list, a `<label>` tied to each field.
- **C6.** Teal links outside buttons take `.link` (or `.link-group` on a wrapper), never `.color-teal-300`, so they lighten on hover.

### D. Colors by job

- **D1.** Every color in an added or changed line is the one the guide's "Which color for what" table gives for that job, in CSS and in `className` alike. Picked by job, not by look.
- **D2.** That includes old colors in lines the change touches. A touched border or background still on `--teal-grey-*` moves to the teal step the table names. (From PR 890, 20 November 2026: a divider kept `--teal-grey-700` where the table says `--teal-800`.)
- **D3.** Error text is `--red-300`. Orange, pink, blue, purple, yellow, and green are for tags. Some older forms still show errors in orange, which doesn't make orange right for new code. (From the corrections pop-up, 22 November 2026.)
- **D4.** Text color in markup comes from a `.color-*` class on the element, not from a `color:` line in a new class, unless the color belongs to a state such as `:hover`. If the class it needs doesn't exist, that is a judgment call: list it.
- **D5.** Borders and dividers are `--teal-800`, or the table's alt mix. A highlight line is `--teal-300`. A plain divider is the `.divider` class.
- **D6.** A job that isn't in the table is Melissa's call. List it; don't pick a color for it.

### E. States and motion

- **E1.** Hover and focus transitions use `var(--hover-transition)`. A hand-written duration on a hover or focus change is a finding. Other timing (a panel sliding in, a fade) is a judgment call: list each new one.
- **E2.** Anything a visitor can click or type in has hover, keyboard-focus, and disabled states. `<Button>` and `.text-field` bring their own. A new interactive piece that isn't built from them is a judgment call: list it, with the states it has.
- **E3.** A new shadow level, or a shadow somewhere the design has none, is a judgment call. (The script already holds shadows to `.drop-shadow` classes and `var(--shadow…)`.)

### F. Existing pages and Melissa's files

- **F1.** Every change to how an existing page looks or behaves is listed, however small. 2px counts. Shared files reach further than the feature: for each changed shared file (`globals.css`, anything in `src/components/`, a class more than one page uses), name every page that uses it and say what changes there. (From the corrections pop-up, 22 November 2026: textarea padding grew on the hackathon forms and a text-selection menu became active in the footer, and neither was listed.)
- **F2.** Anything beyond what was asked (a layout choice, a dropped heading, reworded text) is listed too.
- **F3.** Changes to Melissa's own files need her sign-off and are listed one by one: `docs/css-guidelines.md`, this checklist, `scripts/style-rules.mjs`, and `src/app/globals.css`. (From the corrections pop-up, 22 November 2026: a section of the guide was rewritten without flagging it.)
- **F4.** The pull request description has a "For design review (Melissa)" part. It holds everything from F1 to F3, the judgment calls, and any finding left unfixed with its reason. The description also says which components were reused.

## Where each check comes from

| Source                                                                                                        | Checks                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The guide (`css-guidelines.md`)                                                                               | A5, A6, A8, B1, B4, B5, B6, B7, C1, C3, C6, D1, D2, D3, D4, D5, D6, E3                                                                                                                                                 |
| `CLAUDE.md` (components first, no one-off overrides, flag design decisions in the pull request)               | A1, A2, A3, F1, F2, F4                                                                                                                                                                                                 |
| `docs/claude.md` (same tag for a class, semantic HTML, hover transitions)                                     | C4, C5, E1                                                                                                                                                                                                             |
| Comments in the code (`src/app/design-system/page.tsx`, `src/components/Icon.tsx`)                            | A4, A7                                                                                                                                                                                                                 |
| Our reading of something a review caught, or of a case the source doesn't cover. Not yet confirmed by Melissa | B2, B3, C2, E2, F3, and parts of A5 (a tooltip switched off by a condition), A8 (textareas), C1 (a heading made smaller with a paragraph class), C4 (a file's own classes), and E1 (timing other than hover and focus) |

"The corrections pop-up" is the branch `correction-popover`. An independent review on 22 November 2026, before it was pushed, found six places where it bent the rules after the script and its author had passed it.

## Adding to this list

Whenever Melissa corrects styling, in a review or on Discord, the pull request that fixes it also records the lesson, so the same mistake can't come back:

- If a script can judge it, it becomes a rule in `scripts/style-rules.mjs` with a test in `scripts/style-rules.test.mjs`.
- Otherwise it becomes one line here, in the section it belongs to, ending with where it came from.

A new line takes the next free number in its section. Numbers are never changed or reused, because reviews are recorded against them. If a line turns out to be wrong, Melissa edits or removes it.
