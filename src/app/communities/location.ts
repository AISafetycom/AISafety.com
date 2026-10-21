// The Country filter reads a community's "Location (if in-person)" text.
// Values are "City, Country", "Country", a region ("Europe"), or several of
// those joined with " & ". Each part contributes the text after its last
// comma; a part with no comma is used whole.

// A regional group covers every member country, so ticking Germany also
// shows a Europe-wide group. Europe and Latin America follow the region
// lists on the Jobs page (plus Ecuador, which has a community here); East
// Africa is the East African Community.
const REGION_MEMBERS: Record<string, string[]> = {
  Europe: [
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
  ],
  'Latin America': [
    'Mexico',
    'Brazil',
    'Argentina',
    'Chile',
    'Colombia',
    'Ecuador',
    'Peru',
    'Uruguay',
    'Costa Rica',
  ],
  'East Africa': [
    'Kenya',
    'Tanzania',
    'Uganda',
    'Rwanda',
    'Burundi',
    'South Sudan',
    'DR Congo',
    'Somalia',
  ],
}

function places(location: string | null): string[] {
  if (!location) return []
  return location
    .split(' & ')
    .map(part => part.slice(part.lastIndexOf(',') + 1).trim())
    .filter(Boolean)
}

// A region's member countries, or undefined for anything else.
const membersOf = (place: string) =>
  Object.hasOwn(REGION_MEMBERS, place) ? REGION_MEMBERS[place] : undefined

/** The countries a community names itself: the Country filter's options. */
export function locationCountries(location: string | null): string[] {
  return [...new Set(places(location).filter(p => !membersOf(p)))]
}

/** Every country a community covers, regions expanded to their members:
 *  what the Country filter matches against. */
export function coveredCountries(location: string | null): string[] {
  return [...new Set(places(location).flatMap(p => membersOf(p) ?? [p]))]
}
