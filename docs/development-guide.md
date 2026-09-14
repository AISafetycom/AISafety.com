# Development Guide

## Quick start

```bash
nvm use          # Node 20, from .nvmrc
npm install
npm run dev      # http://localhost:3000
```

No credentials needed. Without Airtable credentials the dev server runs in **contributor mode**: it fetches the site's data from the live site's public Data API, so the full site renders locally. Three things differ in that mode: featured cards don't show (their curation data is internal), the "Updated X days ago" line under page titles is hidden, and features that need private credentials (admin area, chatbot, forms) don't work.

## Team setup (`.env.local`)

Team members with access to the Airtable base add:

```
AIRTABLE_TOKEN=your_personal_access_token
AIRTABLE_BASE_ID=your_base_id
```

Everything else is optional and only needed for the feature it unlocks:

| Add                                                                                               | To get                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `ADMIN_SESSION_SECRET` (copy from Vercel) | the admin area at `/admin/login`, signing in with a Google account that is a root admin or was approved at `/admin/users` |
| `ANTHROPIC_API_KEY`                                                                               | the chatbot (unlimited locally; rate limits need Redis)                                                                   |
| `BLOB_READ_WRITE_TOKEN`                                                                           | permanent image URLs; without it images use Airtable's expiring URLs, fine for a session                                  |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN`                                                           | analytics in Redis; without them events go to a local `.analytics-dev/` file                                              |

The full list is in `docs/architecture.md`. Never commit `.env.local`.

## Commands

| Command               | What it does                                              |
| --------------------- | --------------------------------------------------------- |
| `npm run dev`         | dev server                                                |
| `npm test`            | unit tests (Vitest)                                       |
| `npm run type-check`  | TypeScript, no output                                     |
| `npm run lint`        | ESLint (`lint:fix` to auto-fix)                           |
| `npm run format`      | Prettier (`format:check` to only check)                   |
| `npm run check:icons` | every `<Icon>` is drawn at its file's native size         |
| `npm run build`       | tests, icon check, preview-key pinning, then `next build` |
| `npm run start`       | serve the production build                                |

## Before you commit

Run `npm run type-check`, `npm run lint` and `npm test`. Husky runs lint-staged (ESLint + Prettier) on the files you commit. **There is no CI**, so these local checks are the only gate before a change reaches `main`.

## Where things live

See `CLAUDE.md` at the repo root for the map of `src/` and the project conventions, and `docs/architecture.md` for how the pieces fit together.

## Adding a page

1. Add an entry to `SITE_PAGES` in `src/lib/site-pages.ts` (path, title, one-sentence description, nav icon).
2. Create `src/app/<slug>/page.tsx`. It is a server component:

   ```tsx
   import { pageMetadata } from '@/lib/page-metadata'
   import { SITE_PAGES } from '@/lib/site-pages'
   import PageHeader from '@/components/PageHeader'
   import { getThings } from '@/lib/data/things'
   import ThingsClient from './ThingsClient'

   export const metadata = pageMetadata(SITE_PAGES.things)

   export default async function ThingsPage() {
     const things = await getThings()
     return (
       <div className="container-default">
         <PageHeader title="Things" description="…" />
         <ThingsClient things={things} />
       </div>
     )
   }
   ```

   Filters, sorting and click tracking go in the client component, which receives the data as props. Nothing in the browser fetches from Airtable.

3. Copy a sibling's `opengraph-image.tsx` and point it at your `SITE_PAGES` entry. That gives the page its link-preview card.
4. Add the route to `src/app/sitemap.ts`, and to `Navigation.tsx` and `Footer.tsx` if it belongs in the nav.
5. Give tracked links and pages a stable tracking name from the start (the `trackingPage` prop). Renaming a filter's title or one of its options is fine: change the label in the page, then add one line to `src/lib/filter-tracking.ts` mapping the new wording to the value logged so far. The filter keeps logging its original name and the dashboard shows the new wording for old and new clicks alike.
6. Never rename an existing slug. If a path must move, add a redirect in `next.config.ts`.

## Adding an Airtable table to the data layer

1. Create `src/lib/data/<name>.ts` following `events.ts`: `TABLE_ID`, a `FIELD` map of **permanent field IDs** with the field names as comments (Airtable shows them under "Manage fields" or in the base's API docs), a TypeScript interface for one listing, and a `getThings()` that calls `fetchAirtableRecords` with `returnFieldsByFieldId: true` and `filterByFormula: publishedFormula(FIELD.publish, FIELD.hide)`, then maps rows through the `field*` helpers. Include the contributor-mode fallback (`hasAirtableCredentials()` / `fetchPublicData`) like the other modules.
2. Add the table to `TABLES` in `src/app/api/check-rebuild/route.ts` so edits to published rows trigger a rebuild, and to `src/lib/data/last-updated.ts` if the page shows the "Updated" line.
3. If the data should be public, register the endpoint in `src/lib/api/registry.ts`, add `src/app/api/v1/<slug>/route.ts` using `createCollectionHandler`, and note it in `docs/api-changelog.md`.
4. Add the table to `RESOURCE_TABLES` in `src/lib/assistant/catalog-coverage.ts` (or to the internal denylist if visitors should not see it). The daily catalog check flags any table that is in neither.

## Styling

Read `docs/css-guidelines.md` before writing any CSS. The short version: `globals.css` is the design system, use its variables and utility classes first; new classes go in a `.module.css` next to the component or page; fix shared components at their shared definition, never with a one-off override.

## Icons

An icon file's native size is its only display size: a 16px icon renders at 16, a 24px icon at 24, never scaled. If you need another size, that is a different file (`x.svg` vs `x-small.svg`). `npm run check:icons` (also part of the build) fails when a static `<Icon size={N}>` disagrees with the file.

## Tests

Pure logic (ordering, parsing, formatting, validation) goes in a dependency-free module under `src/lib` with a `*.test.ts` next to it, following `training-order.ts` and `featured.ts`. Vitest runs in a node environment, so nothing that imports Next, d3 or the DOM. Visual changes are checked by hand in a browser, at desktop and mobile widths.

## Admin and preview mode locally

Copy `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `ADMIN_SESSION_SECRET` from Vercel into `.env.local` and sign in at `/admin/login` with a Google account that is a root admin in `src/lib/admin/users.ts` or was approved at `/admin/users` (the dev port must be among the Google client's registered redirect URIs; 3000 is). There is no password.

## Troubleshooting

- **"[contributor mode] No Airtable credentials"** in the console, featured cards missing, no "Updated" line: expected without credentials. Add `AIRTABLE_TOKEN` and `AIRTABLE_BASE_ID` for the full site.
- **Images broken after a while:** without `BLOB_READ_WRITE_TOKEN` the site uses Airtable's signed URLs, which expire in a couple of hours. Restart the dev server, or add the token.
- **Airtable 429 errors:** the base allows five requests per second. Go through `fetchAirtableRecords` (cached, paced) rather than calling Airtable directly, and avoid many parallel uncached reads.
- **"Module not found":** `rm -rf node_modules && npm install`.
- **Type or lint errors:** `npm run type-check` and `npm run lint`; fix them before committing, the pre-commit hook will otherwise stop you.
