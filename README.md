# AISafety.com

A community resource website helping people find events, organizations, jobs, funding, and learning resources in AI safety. Migrated from WebFlow.

## Tech Stack

| What       | Technology                          |
| ---------- | ----------------------------------- |
| Framework  | Next.js 16 (App Router)             |
| Language   | TypeScript                          |
| Styling    | Constraint-based CSS (not Tailwind) |
| Data       | Airtable                            |
| Map        | D3.js                               |
| Deployment | Vercel                              |

## Getting Started

```bash
nvm use
npm install
npm run dev
```

That's it — no credentials needed. Without Airtable credentials the dev
server runs in **contributor mode**: it fetches the site's data from the
live site's public [Data API](./docs/api.md), so anyone can clone the repo
and see the full site locally.

A few things work differently in contributor mode:

- Featured cards don't show (their curation data is internal).
- The "Updated X days ago" line under page titles is hidden.
- Features that need private credentials — the suggestion forms, the admin
  panel, and the chatbot — won't work.

None of that gets in the way of working on pages, components, styling, or
the map.

### Team setup (direct Airtable access)

Team members with access to the Airtable base create `.env.local`:

```
AIRTABLE_TOKEN=your_token
AIRTABLE_BASE_ID=your_base_id
```

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build (runs the tests first)
npm test             # Unit tests
npm run lint         # Run linting
npm run format       # Format code
npm run type-check   # Type check
```

## Project Structure

```
src/
├── app/                    # Pages and API routes
│   ├── page.tsx            # Homepage
│   ├── layout.tsx          # Root layout (nav + footer)
│   ├── globals.css         # All global styles
│   ├── map/                # Interactive field map (D3.js)
│   ├── events/
│   ├── training/
│   ├── api/                # Backend API routes
│   │   ├── ...
├── components/             # Reusable UI pieces
│   ├── ...
public/
├── images/                 # Icons, logos, background images
docs/                       # Detailed documentation
backup/
├── *.html                  # Original WebFlow exports (reference only)
```

## Public Data API

A read-only JSON API exposes the directories (communities, events, organizations,
jobs, funding, …) for reuse by other AI-safety sites and tools, with no API key,
CORS open, data licensed CC-BY-4.0. Human docs at `/developers`; spec at
`/api/v1/openapi.json`. See [docs/api.md](./docs/api.md).

## Documentation

- [Data API](./docs/api.md)
- [Architecture](./docs/architecture.md)
- [Development Guide](./docs/development-guide.md)
- [CSS Guidelines](./docs/css-guidelines.md)
- [CLAUDE.md](./CLAUDE.md) — how the codebase works and its conventions (written for Claude Code, useful for humans too)
- [Development philosophy](./docs/claude.md)
