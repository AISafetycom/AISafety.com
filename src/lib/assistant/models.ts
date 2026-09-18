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
    id: 'claude-sonnet-5',
    shortLabel: 'Sonnet 5',
    longLabel: 'Sonnet 5 — balanced',
  },
  {
    id: 'claude-opus-5',
    shortLabel: 'Opus 5',
    longLabel: 'Opus 5',
  },
  {
    id: 'claude-fable-5-1',
    shortLabel: 'Fable 5.1',
    longLabel: 'Fable 5.1 — most capable',
  },
]

export const DEFAULT_MODEL_ID = 'claude-opus-5'

/** Fable-tier models think whether asked or not: the API rejects
 *  `thinking: { type: 'disabled' }` for them with a 400. */
export function thinkingAlwaysOn(id: string): boolean {
  return /^claude-(fable|mythos)-/.test(id)
}

/** The `thinking` request field for a model. The assistant reasons in visible
 *  text (ending with the [[/thinking]] marker) rather than in API thinking
 *  blocks, so thinking is switched off wherever the API allows it. For models
 *  that can't have it off the field is left out (the API then runs adaptive
 *  thinking) and the stream loop echoes their thinking blocks back. */
export function thinkingParam(id: string): { type: 'disabled' } | undefined {
  return thinkingAlwaysOn(id) ? undefined : { type: 'disabled' }
}

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
