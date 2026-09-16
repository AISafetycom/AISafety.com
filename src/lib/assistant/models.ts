// Single source of truth for the Anthropic model IDs the assistant talks to.
// Production uses DEFAULT_MODEL; the admin playground lets a human pick from
// MODELS when iterating on the prompt.

export interface AssistantModel {
  id: string
  shortLabel: string
  longLabel: string
}

export const MODELS: AssistantModel[] = [
  {
    id: 'claude-haiku-4-5-20251001',
    shortLabel: 'Haiku 4.5',
    longLabel: 'Haiku 4.5 — fast',
  },
  {
    id: 'claude-sonnet-4-6',
    shortLabel: 'Sonnet 4.6',
    longLabel: 'Sonnet 4.6 — balanced',
  },
  {
    id: 'claude-opus-4-7',
    shortLabel: 'Opus 4.7',
    longLabel: 'Opus 4.7',
  },
  {
    id: 'claude-opus-4-8',
    shortLabel: 'Opus 4.8',
    longLabel: 'Opus 4.8',
  },
  {
    id: 'claude-opus-5',
    shortLabel: 'Opus 5',
    longLabel: 'Opus 5 — most capable',
  },
]

export const DEFAULT_MODEL_ID = 'claude-opus-5'

/** Whether an id names one of the models the playground may pick. */
export function isKnownModelId(id: string): boolean {
  return MODELS.some(m => m.id === id)
}

export function modelShortLabel(id: string): string {
  return MODELS.find(m => m.id === id)?.shortLabel ?? id
}

/** Human-facing model name the assistant can tell users (e.g. "Claude Opus
 *  4.8"). Falls back to a generic name for unknown ids so we never leak a
 *  raw API id to a user. */
export function modelDisplayName(id: string): string {
  const known = MODELS.find(m => m.id === id)
  return known ? `Claude ${known.shortLabel}` : "Anthropic's Claude"
}
