# AISafety.com

## What this is

The code behind [aisafety.com](https://aisafety.com): a Next.js 16 (App Router) + TypeScript site on Vercel. It is a directory of AI safety resources across twelve resource pages (events, training, field map, communities, self-study, jobs, funding, media channels, advisors, volunteer projects, donation guide, founder toolkit), all fed from one Airtable base. Around that sit a chatbot, a public read-only Data API, first-party analytics, and a password-gated admin area.

The site was migrated from Webflow in 2026 and the migration is finished. **The code is the source of truth now.** `backup/` is the old Webflow snapshot, kept only for reference until issue #297 removes it. Do not copy from it, and do not treat the live site as a spec to replicate.

Nearly all code here is written with Claude Code, reviewed by a non-technical owner (Bryce) and a designer (Melissa). That shapes how to work: explain changes in plain English, keep diffs focused, and flag design decisions rather than making them silently.

## Where things live

```
src/app/                 one folder per route (page.tsx + page.module.css)
src/app/api/v1/          public Data API (docs/api.md)
src/app/api/track        first-party analytics beacon (public, length-capped)
src/app/api/assistant    chatbot streaming endpoint + conversation log
src/app/admin/           admin area: analytics, chatbot log + playground, map editor, preview, newsletter
src/components/          shared UI (cards, filters, nav, footer, search, chatbot widget)
src/lib/data/            Airtable data layer: one file per table, one getX() per page
src/lib/api/             Data API plumbing (endpoint registry, filters, response envelope)
src/lib/assistant/       chatbot: prompt.ts, tools, catalog, rate limit, model pins
src/lib/analytics/       event store (Upstash Redis in prod, NDJSON file locally)
src/lib/admin/           admin-only helpers (auth, map editor, newsletter approval)
src/lib/site-pages.ts    title + description + icon for every public page
src/proxy.ts             reports AI-assistant fetches to Matomo
src/app/globals.css      the design system (see CSS below)
scripts/                 build-time checks (icon sizes, preview keys)
docs/                    css-guidelines, api + changelog, architecture notes
```

## Airtable is the database

- **Reference fields by permanent field ID, never by name.** Each data file has a `FIELD` map of IDs with the field name as a comment, and records are fetched with `returnFieldsByFieldId`. Renames in Airtable then cannot break the site. If you change a helper's signature, grep every call site.
- **Only records with Publish? checked and Hide? unchecked are live** (`publishedFormula` in `src/lib/data/airtable.ts`). Code never sets those two fields. The site's only Airtable writes are the admin map editor (x and y, or Scale), the chatbot conversation log, and the admin's annotations on that log.
- **Never put a raw Airtable attachment URL in a page or API response.** They expire within hours. Attachments are mirrored to Vercel Blob and the Blob URL is what gets served.
- **Pages are prerendered at build time; runtime readers use an hourly cache** (`unstable_cache`, tag `airtable-records`). A Vercel cron calls `/api/check-rebuild` every minute; when a published row has changed it clears that cache and triggers a redeploy through a deploy hook, so an Airtable edit reaches the live site in about two to three minutes. Preview mode (`/admin/preview`, Next Draft Mode) bypasses the caches for that admin only.
- **Airtable allows five requests per second per base.** Don't add uncached Airtable reads on request paths; go through `fetchAirtableRecords` and the existing data functions.
- **Contributor mode:** with no Airtable credentials the dev server reads the live Data API instead, so anyone can run the site locally (see README).

## Copy and content rules

- **American English** everywhere on the site, even though the owner writes NZ English.
- **Dates are DATE MONTH YEAR** ("4 February 2026"). Use the helpers in `src/lib/format-date.ts`.
- **Neutral voice:** "The directory lists…", never "our directory" or "we list". Don't push jobs on the homepage.
- **Locations:** "USA", never "US". Multiple places in one facet join with " & ", never a comma.
- **Never change a URL slug.** If a path must move, keep the old one working with a redirect in `next.config.ts`.
- **Page titles and descriptions live in `SITE_PAGES`** and reach `<head>` through `pageMetadata()`. Don't add a page-level `openGraph` block: it hides the route's generated link-preview card (the comment in `src/lib/page-metadata.ts` explains why).
- **Outbound links to other sites get UTM tags** through `withUtm()`. Stored URLs stay clean; analytics records the clean URL.
- **Renaming a filter or button? Keep its analytics name stable** (the `trackingTitle` prop) so dashboard history isn't split.

## CSS: reuse, never recreate

Read `docs/css-guidelines.md` (Melissa's rules) before writing any styles. In short:

- `globals.css` is the design system: variables for every color, pre-styled `h1`–`h3` and `p`, and utility classes for typography, spacing, layout, color, and buttons. Use them first. Never hardcode a hex value or add a new variable.
- New classes only when utilities can't do it, in `ComponentName.module.css` or `page.module.css`. Rarely `globals.css`, and only for something truly reusable.
- If a shared component looks wrong, fix its shared definition (for example `.button-primary`) so every instance is fixed at once. No one-off overrides.
- Diagnose before fixing. The right CSS fix is usually fewer lines, not more.

## Errors: never silently fail

- Don't catch and ignore exceptions, don't substitute defaults for invalid data, don't skip failed items without logging.
- Throw with a clear message; let the build fail loudly on malformed data; use `console.warn` for recoverable issues.
- The one deliberate exception is analytics: the tracking beacon, the Matomo ping, and chatbot logging are fire-and-forget and must never break a page. Say so in a comment wherever you swallow one of those.

## Chatbot

- The system prompt lives in `src/lib/assistant/prompt.ts` and is edited only in code. Bump `PROMPT_VERSION` on any meaningful prompt change so logged conversations stay attributable. Try drafts in `/admin/chatbot/playground` before shipping.
- Model IDs are pinned in `src/lib/assistant/models.ts`, one place only.
- The bot recommends only resources the site lists. Don't add off-site fallbacks.
- Logging happens after the response is sent (`after()`), never on the streaming path.

## Analytics

- Two systems: Matomo (script in the root layout, plus `src/proxy.ts` for AI-assistant fetches) and the first-party store in `src/lib/analytics/events.ts` behind `/api/track`, shown at `/admin/analytics`.
- New event kinds go in `ALLOWED_EVENT_TYPES`; every field the beacon accepts is length-capped. Keep it that way.

## Admin area

- People sign in with Google; each has one boolean per area (`src/lib/admin/access.ts`). A new admin page must check the specific capability it needs (`src/lib/admin/auth.ts`), not just `isAdmin()`.
- `/admin/queue` is the owner's review inbox for proposed directory changes (docs/architecture.md, "Queue"). Bots write the rows on the owner's Mac; the site only decides them. Nothing there may ever auto-apply.
- Keep admin writes narrow and explicit. The map editor accepts only x, y and Scale and rejects any other key; follow that pattern.

## Public Data API

- `/api/v1` is a thin skin over the `getX()` functions, so data shaping belongs in `src/lib/data`, never in the API layer. `docs/api.md` describes it; `docs/api-changelog.md` records changes. Breaking changes go to `/api/v2`, never into v1.

## Checks before you commit

```bash
npm run type-check
npm run lint
npm test
```

- `npm run build` runs the vitest suite first, then builds. Husky runs lint-staged on every commit.
- Pure logic (ordering, formatting, parsing) goes in a dependency-free `src/lib` module with a vitest test next to it, following `training-order.ts` and `featured.ts`.
- Verify visual changes in a real browser on localhost, at desktop and mobile widths. Compare against the design rules, not against the old Webflow site.
- **There is no CI yet.** Nothing runs automatically on push, so these local checks are the only gate.

## Git and pull requests

- Branch from up-to-date `main`. Never push to `main` directly; open a pull request.
- Commit subjects describe the user-visible change, in the present tense, often prefixed with the page: "Jobs: show each location on its own line".
- PR body: one or two plain-English sentences on what changes and why, then bullets for the details. No "Test plan" section. When a change goes beyond what was asked (a layout choice, dropped headings), say so and flag it for design review.
- End the PR body with a single attribution line: 🤖 Generated with [Claude Code](https://claude.com/claude-code)

## Reference

- `docs/css-guidelines.md` — styling rules, current and authoritative
- `docs/api.md`, `docs/api-changelog.md` — the public Data API
- `docs/claude.md` — development philosophy: keep it simple, collocate, extract only on real reuse
- `docs/architecture.md` — the admin map editor and newsletter sections are current; the overview at the top predates the data layer
- `docs/development-guide.md` — setup and commands; its Airtable fetching examples predate `src/lib/data`
- `README.md` — contributor mode and team setup
