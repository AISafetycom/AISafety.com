// Shared region → member-country table. A "country" value (a job's
// location, a candidate's country) can sometimes be a whole region instead
// of a single country (80k's job data uses "Europe"; the assistant's
// search_listings tool accepts a region name in a `country` filter so a
// query like "in Europe" doesn't need every member country spelled out).
// Wherever a country is checked against a region, member-country lookups go
// through this one table so the two stay in sync.
export const REGION_MEMBERS: Record<string, Set<string>> = {
  Europe: new Set([
    'UK',
    'Ireland',
    'France',
    'Germany',
    'Netherlands',
    'Belgium',
    'Luxembourg',
    'Switzerland',
    'Austria',
    'Denmark',
    'Norway',
    'Sweden',
    'Finland',
    'Iceland',
    'Spain',
    'Portugal',
    'Italy',
    'Greece',
    'Poland',
    'Czechia',
    'Czech Republic',
    'Slovakia',
    'Hungary',
    'Romania',
    'Bulgaria',
    'Croatia',
    'Serbia',
    'Slovenia',
    'Estonia',
    'Latvia',
    'Lithuania',
    'Ukraine',
  ]),
  Asia: new Set([
    'China',
    'India',
    'Japan',
    'Singapore',
    'South Korea',
    'Taiwan',
    'Hong Kong',
    'Indonesia',
    'Malaysia',
    'Thailand',
    'Vietnam',
    'Philippines',
    'Israel',
    'United Arab Emirates',
    'UAE',
    'Saudi Arabia',
    'Turkey',
  ]),
  'Middle East': new Set([
    'Israel',
    'United Arab Emirates',
    'UAE',
    'Saudi Arabia',
    'Qatar',
    'Turkey',
    'Jordan',
    'Egypt',
  ]),
  'North America': new Set(['USA', 'Canada', 'Mexico']),
  'Latin America': new Set([
    'Mexico',
    'Brazil',
    'Argentina',
    'Chile',
    'Colombia',
    'Peru',
    'Uruguay',
    'Costa Rica',
  ]),
  'South America': new Set([
    'Brazil',
    'Argentina',
    'Chile',
    'Colombia',
    'Peru',
    'Uruguay',
  ]),
  Africa: new Set([
    'South Africa',
    'Nigeria',
    'Kenya',
    'Ghana',
    'Egypt',
    'Morocco',
    'Rwanda',
    'Uganda',
  ]),
  Oceania: new Set(['Australia', 'New Zealand']),
}

export const REGION_NAMES = Object.keys(REGION_MEMBERS)

/** Case-insensitive region name → member set, for callers matching a
 *  free-typed filter value (e.g. the assistant's search_listings tool)
 *  rather than a fixed option list. */
export const REGION_MEMBERS_BY_LOWER_NAME: Record<
  string,
  Set<string>
> = Object.fromEntries(
  Object.entries(REGION_MEMBERS).map(([name, members]) => [
    name.toLowerCase(),
    members,
  ])
)
