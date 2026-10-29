export const EVENT_TYPES = [
  'Competition',
  'Conference',
  'Hackathon',
  'Meetup',
  'Talk',
  'Workshop',
  'Other',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

const EVENT_TYPE_COLOR: Record<string, string> = {
  Conference: 'color-orange-300',
  Talk: 'color-pink-300',
  Workshop: 'color-green-300',
  Meetup: 'color-blue-300',
  Hackathon: 'color-purple-300',
  Competition: 'color-yellow-300',
  Other: 'color-teal-grey-300',
}

export function eventTypeColor(type: string): string {
  return EVENT_TYPE_COLOR[type] ?? 'color-teal-400'
}
