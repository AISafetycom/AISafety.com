export const TRAINING_TYPES = [
  'Fellowship',
  'Course',
  'Bootcamp',
  'Immersive workshop',
  'Other',
] as const

export type TrainingType = (typeof TRAINING_TYPES)[number]

const TRAINING_TYPE_COLOR: Record<string, string> = {
  Fellowship: 'color-orange',
  Bootcamp: 'color-pink',
  Course: 'color-bright-green',
  'Immersive workshop': 'color-blue',
  Other: 'color-teal-grey-300',
}

export function trainingTypeColor(type: string): string {
  return TRAINING_TYPE_COLOR[type] ?? 'color-teal-400'
}

export const ENTRY_BARS = ['Low', 'Mid', 'High'] as const
export type EntryBar = (typeof ENTRY_BARS)[number]

// Options for the Stipend filter — a ladder of support levels. "Expenses
// covered" means the program directly provides costs like housing, food,
// and travel but pays no cash; programs that pay cash (even alongside
// covered expenses) are "Stipend included".
export const STIPEND_OPTIONS = [
  'No stipend',
  'Expenses covered',
  'Stipend included',
] as const

export const LENGTH_BUCKETS = [
  'Under 1 month',
  '1–3 months',
  '3+ months',
] as const
export type LengthBucket = (typeof LENGTH_BUCKETS)[number]
