import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_ID,
  MODELS,
  currentModelId,
  isKnownModelId,
  modelDisplayName,
  outputConfig,
  thinkingAlwaysOn,
  thinkingParam,
} from './models'

describe('model list', () => {
  it('offers one model per tier, with the production model among them', () => {
    expect(MODELS.map(m => m.id)).toEqual([
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-fable-5-2',
    ])
    expect(isKnownModelId(DEFAULT_MODEL_ID)).toBe(true)
  })

  it('keeps production on Opus 5.5', () => {
    expect(DEFAULT_MODEL_ID).toBe('claude-opus-5-5')
    expect(modelDisplayName(DEFAULT_MODEL_ID)).toBe('Claude Opus 5.5')
  })
})

describe('thinking and effort per model', () => {
  // What the API accepted on 10 November 2026: `thinking: { type: 'disabled' }`
  // is a 400 for Sonnet 5.5, Opus 5.5 and Fable 5.2, and fine for Haiku 5.5.
  it('sends `disabled` only to the model that accepts it', () => {
    expect(thinkingParam('claude-haiku-5-5')).toEqual({ type: 'disabled' })
    for (const id of [
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-fable-5-2',
    ]) {
      expect(thinkingAlwaysOn(id)).toBe(true)
      expect(thinkingParam(id)).toBeUndefined()
    }
  })

  it('names an effort level for the production model only', () => {
    expect(outputConfig(DEFAULT_MODEL_ID, 'medium')).toEqual({
      effort: 'medium',
    })
    for (const m of MODELS.filter(m => m.id !== DEFAULT_MODEL_ID)) {
      expect(outputConfig(m.id, 'medium')).toBeUndefined()
    }
  })
})

describe('currentModelId', () => {
  it('keeps a listed model as it is', () => {
    for (const m of MODELS) expect(currentModelId(m.id)).toBe(m.id)
  })

  it('moves a model that is no longer listed to the same tier', () => {
    expect(currentModelId('claude-fable-5-1')).toBe('claude-fable-5-2')
    expect(currentModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-5-5')
    expect(currentModelId('claude-sonnet-5')).toBe('claude-sonnet-5-5')
    expect(currentModelId('claude-opus-5')).toBe('claude-opus-5-5')
  })

  it('falls back to the production model for anything else', () => {
    expect(currentModelId(undefined)).toBe(DEFAULT_MODEL_ID)
    expect(currentModelId('')).toBe(DEFAULT_MODEL_ID)
    expect(currentModelId('claude-mythos-5-1')).toBe(DEFAULT_MODEL_ID)
    expect(currentModelId('not-a-model')).toBe(DEFAULT_MODEL_ID)
  })
})
