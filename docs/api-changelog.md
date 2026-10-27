# AISafety.com Data API Changelog

Consumers: breaking changes to a published version will be announced here before
they ship. Backwards-compatible additions (new fields, new endpoints) can happen
at any time.

## v1 (unreleased)

Initial release.

- 10 read-only collection endpoints under `/api/v1`: `communities`,
  `organizations`, `events`, `jobs`, `funding`, `courses`, `advisors`,
  `media-channels`, `founder-resources`, `projects`.
- Wrapped `{ data, meta }` envelope; `meta` carries count, license, attribution,
  source, and `generatedAt`.
- Query-param filtering (case-insensitive substring, comma for OR) plus free-text
  `q` search.
- Open access, no API key, CORS `*`, `GET`/`OPTIONS` only.
- Data licensed CC-BY-4.0.
- `GET /api/v1` index and `GET /api/v1/openapi.json` spec; human docs at
  `/developers`.
- New `events` endpoint normalizes the events table (previously only an Airtable
  iframe embed on the site).
- `jobs` `logo` is a 256-pixel WebP copy on Vercel Blob instead of a link to
  80000hours.org (20 October 2026).
- `funding` gains `applicationStatus`, `deadline`, `whoCanApply`, `grantSize`,
  `grantMinUsd`, and `grantMaxUsd`; the existing fields are unchanged (27 October
  2026).
- `advisors` gains `whoItsFor`, `focusAreas`, and `applications`; the existing
  fields are unchanged (27 October 2026).
- `funding` can be filtered by `applicationStatus` and `whoCanApply`, and
  `advisors` by `whoItsFor`, `focusAreas`, and `applications` (27 October
  2026).
- Deprecated: `funding`'s `recipientType` has been an empty string on every
  record since its Airtable field was retired in July 2026, so filtering on it
  matches nothing. Use `whoCanApply` (`Individuals`, `Nonprofits`,
  `For-profits`, or `Universities`) instead. `recipientType` stays in v1
  responses and filters and is removed in v2 (27 October 2026).
