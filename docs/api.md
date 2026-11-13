# AISafety.com Data API (v1)

A public, read-only JSON API over the AISafety.com directories, so other sites
and tools in the AI-safety ecosystem can embed live data (events, communities,
organizations, and more) without maintaining their own copy.

- **Human docs:** `/developers`
- **Index (self-describing):** `GET /api/v1`
- **OpenAPI 3.1 spec:** `GET /api/v1/openapi.json`
- **License:** [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) (also surfaced in every response's `meta` and on `/developers`).

## Design

The API is a thin HTTP skin over the existing typed data layer in
`src/lib/data/*.ts`. Each endpoint reuses that module's `getX()` function, so
data shaping lives in exactly one place and the API stays consistent with the
site.

- **Source of truth:** Airtable base `appF8XfZUGXtfi40E` (same as the site).
- **Caching / rate limits:** responses set `Cache-Control: s-maxage` for the CDN,
  and the underlying Airtable fetch uses Next's Data Cache (hourly). This keeps
  Airtable calls well under its 5 req/sec per-base limit regardless of API
  traffic. There is no separate datastore.
- **Access:** fully open, no API key, permissive CORS (`*`), `GET`/`OPTIONS` only.
- **Versioning:** path-versioned under `/api/v1`. Breaking changes go to `/api/v2`.

## Response shape

Every collection endpoint returns a wrapped envelope:

```json
{
  "data": [{ "id": "rec...", "name": "...", "...": "..." }],
  "meta": {
    "count": 1,
    "license": "CC-BY-4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "AISafety.com",
    "source": "https://aisafety.com",
    "generatedAt": "2026-06-16T00:00:00.000Z"
  }
}
```

- IDs are stable Airtable record IDs.
- Image fields (`logo`, `image`, `mapLogo`) are permanent Vercel Blob URLs
  (`*.public.blob.vercel-storage.com`), not Airtable's expiring attachment URLs.
  Job logos are 256-pixel WebP copies of images hosted by 80,000 Hours; a logo
  whose source can't be reached when it first appears keeps the source address
  until a later refresh copies it.
- Dates are ISO-8601 strings.

## Filtering

- `?<field>=value` does a case-insensitive substring match on a whitelisted field.
- `?<field>=a,b` treats commas as OR.
- Multiple params are AND'd across fields.
- `?q=text` does a free-text search across all fields.

Whitelisted filter fields per endpoint live in `src/lib/api/registry.ts`.

## Deprecated fields

These stay in v1 responses and filters, with the same kind of values, until v2
drops them. New code should use the newer fields instead.

| Endpoint   | Field                   | Use instead                        | Since           |
| ---------- | ----------------------- | ---------------------------------- | --------------- |
| `funding`  | `recipientType`         | `whoCanApply`                      | 27 October 2026 |
| `funding`  | `acceptingApplications` | `applicationStatus` and `deadline` | 28 October 2026 |
| `advisors` | `focus`                 | `focusAreas`                       | 28 October 2026 |

`recipientType` is an empty string on every record. `acceptingApplications` is
worked out from `applicationStatus` and `deadline`, and `focus` from
`focusAreas`; see `docs/api-changelog.md`.

## Endpoints

`communities`, `organizations`, `events`, `training`, `jobs`, `funding`,
`courses`, `advisors`, `media-channels`, `founder-resources`, `projects`.

## Privacy

Endpoints serve only what is already public on the site. Internal and personal
fields are excluded by allowlist.

## Code map

```
src/lib/api/
  constants.ts   license / attribution / base path
  registry.ts    single source of truth for endpoints (filters, fields, TTLs)
  response.ts    CORS, envelope, meta
  filter.ts      in-memory query/search
  handler.ts     createCollectionHandler() + OPTIONS
src/lib/data/events.ts            events normalizer (shared with the chatbot)
src/app/api/v1/<entity>/route.ts  one thin route per endpoint
src/app/api/v1/route.ts           index
src/app/api/v1/openapi.json/route.ts  generated spec
src/app/developers/page.tsx       human docs
```

## Known limitations and future work

- **Image freshness:** a brand-new image in Airtable is mirrored to Vercel Blob
  on the next data refresh (at most an hour, no redeploy needed) and its URL is
  permanent from then on.
- **Per-dataset `lastUpdated`** in `meta` (deferred; `generatedAt` is provided).
- **Pagination** and **server-side sorting** (deferred; collections are small).
- **UI embed widget**, a zero-code drop-in for non-technical chapters (deferred).
- **API keys**, only if abuse appears (intentionally keyless for now).
