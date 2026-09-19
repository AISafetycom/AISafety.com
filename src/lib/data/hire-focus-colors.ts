// Colors a candidate's focus-area chips on /hire. Reuses the site's existing
// accent color utilities (docs/css-guidelines.md) — no new hex values.
// Falls back to the same neutral default ListingCard's pills use for an
// unrecognized value, so a new focus area someone adds later just renders
// neutral instead of breaking.
const FOCUS_AREA_COLOR_CLASS: Record<string, string> = {
  interpretability: 'color-orange',
  evals: 'color-bright-green',
  'agent safety': 'color-blue',
  'alignment theory': 'color-purple',
  governance: 'color-pink',
  security: 'color-yellow',
  biosecurity: 'color-bright-green',
}

const DEFAULT_COLOR_CLASS = 'color-teal-bright-400'

export function focusAreaColorClass(focusArea: string): string {
  return FOCUS_AREA_COLOR_CLASS[focusArea.toLowerCase()] ?? DEFAULT_COLOR_CLASS
}
