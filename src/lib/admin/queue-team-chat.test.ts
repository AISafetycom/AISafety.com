import { describe, expect, it } from 'vitest'
import {
  chatKind,
  chatOwners,
  isTeamChatPath,
  teamBody,
  TEAM_BODY_MAX_BYTES,
  TEAM_CHAT_PATHS,
  TEAM_SMALL_BODY_MAX_BYTES,
} from './queue-team-chat'

const ROOTS = ['Owner@Example.org']

describe('chatOwners', () => {
  it('defaults to the root admins', () => {
    expect([...chatOwners(undefined, ROOTS)]).toEqual(['owner@example.org'])
    expect([...chatOwners('  ,, ', ROOTS)]).toEqual(['owner@example.org'])
  })
  it('reads a comma list in place of them', () => {
    expect([...chatOwners(' A@x.org, b@x.org ', ROOTS)]).toEqual([
      'a@x.org',
      'b@x.org',
    ])
  })
})

describe('chatKind', () => {
  const owners = chatOwners(undefined, ROOTS)
  const who = (over: Partial<Parameters<typeof chatKind>[0]>) =>
    chatKind({
      email: 'rob@example.org',
      owners,
      canWork: true,
      teamOn: true,
      ...over,
    })
  it('gives an owner the Mac chat, whatever else is set', () => {
    expect(who({ email: 'owner@example.org' })).toBe('mac')
    expect(who({ email: ' OWNER@example.org', teamOn: false })).toBe('mac')
  })
  it('gives everyone else who works the Queue the team chat', () => {
    expect(who({})).toBe('team')
  })
  it('gives a viewer none', () => {
    expect(who({ canWork: false })).toBeNull()
  })
  it('is off without the team agent secret', () => {
    expect(who({ teamOn: false })).toBeNull()
  })
  it('follows QUEUE_CHAT_OWNERS', () => {
    const listed = chatOwners('rob@example.org', ROOTS)
    expect(who({ owners: listed })).toBe('mac')
    expect(who({ owners: listed, email: 'owner@example.org' })).toBe('team')
  })
})

describe('the paths the page may ask for', () => {
  it('is the chat panel’s own calls and nothing else', () => {
    expect([...TEAM_CHAT_PATHS].sort()).toEqual([
      '/chat',
      '/chat/clear',
      '/chat/file',
      '/chat/history',
      '/chat/interrupt',
      '/chat/unqueue',
    ])
  })
  it('refuses everything else the Mac agent answers', () => {
    for (const path of [
      '/act',
      '/ping',
      '/chat/dictate',
      '/chat/status',
      '/rule/draft',
      '/rule/status',
      '/chat/',
      '/chat/history/',
      '/CHAT',
      'chat',
      '',
      null,
      undefined,
      7,
      ['/chat'],
    ]) {
      expect(isTeamChatPath(path)).toBe(false)
    }
  })
})

describe('teamBody', () => {
  it('drops a token or a who the browser sent', () => {
    const got = teamBody('/chat', {
      id: 'recROW00000000001',
      message: 'hello',
      token: 'a-token',
      who: { email: 'owner@example.org', name: 'Owner', mode: 'edit' },
    })
    expect(got).toEqual({
      ok: true,
      body: { id: 'recROW00000000001', message: 'hello' },
      bytes: expect.any(Number),
    })
  })
  it('keeps the rest as sent, the page’s own `at` included', () => {
    const got = teamBody('/chat/unqueue', {
      id: 'rec1',
      at: '2026-11-27T00:00:00.000Z',
    })
    expect(got.ok && got.body).toEqual({
      id: 'rec1',
      at: '2026-11-27T00:00:00.000Z',
    })
  })
  it('refuses what is not an object', () => {
    for (const bad of [null, undefined, 'text', 3, [1, 2]]) {
      expect(teamBody('/chat', bad)).toMatchObject({ ok: false, status: 400 })
    }
  })
  it('refuses a body over 3.5 MB, counted in bytes', () => {
    const fits = teamBody('/chat', {
      data: 'a'.repeat(TEAM_BODY_MAX_BYTES - 100),
    })
    expect(fits.ok).toBe(true)
    expect(
      teamBody('/chat', { data: 'a'.repeat(TEAM_BODY_MAX_BYTES) })
    ).toMatchObject({
      ok: false,
      status: 413,
    })
    // Two bytes a character: half the characters is already too many.
    expect(
      teamBody('/chat', { data: 'é'.repeat(TEAM_BODY_MAX_BYTES / 2) })
    ).toMatchObject({ ok: false, status: 413 })
  })
  it('takes only a small body on every path but a message', () => {
    const big = { id: 'rec1', data: 'a'.repeat(TEAM_SMALL_BODY_MAX_BYTES) }
    expect(teamBody('/chat', big).ok).toBe(true)
    for (const path of TEAM_CHAT_PATHS.filter(p => p !== '/chat')) {
      expect(teamBody(path, big)).toMatchObject({ ok: false, status: 413 })
      expect(teamBody(path, { id: 'rec1', file: 'a.png' }).ok).toBe(true)
    }
  })
})
