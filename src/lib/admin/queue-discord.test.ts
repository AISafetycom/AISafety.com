import { describe, expect, it } from 'vitest'
import { discordAppLink, replyToCopy } from './queue-discord'

describe('discordAppLink', () => {
  it('opens a DM message in the Discord app', () => {
    expect(discordAppLink('https://discord.com/channels/@me/123/456')).toBe(
      'discord://-/channels/@me/123/456'
    )
  })

  it('opens a server message in the Discord app', () => {
    expect(discordAppLink('https://discord.com/channels/111/222/333?x=1')).toBe(
      'discord://-/channels/111/222/333'
    )
  })

  it('takes the older and test-build hosts too', () => {
    expect(discordAppLink('https://discordapp.com/channels/1/2')).toBe(
      'discord://-/channels/1/2'
    )
    expect(discordAppLink('https://ptb.discord.com/channels/1/2/3')).toBe(
      'discord://-/channels/1/2/3'
    )
  })

  it('leaves any other link alone', () => {
    expect(discordAppLink('https://discord.gg/abc')).toBe(
      'https://discord.gg/abc'
    )
    expect(discordAppLink('https://example.com/channels/1/2')).toBe(
      'https://example.com/channels/1/2'
    )
  })
})

describe('replyToCopy', () => {
  const base = {
    source: 'Discord',
    alreadyReplied: false,
    shownReply: 'From Fable:\n>>> Listed.',
    rejectReply: 'From Fable:\n>>> Not this time.',
  }

  it('copies the shown reply on accept', () => {
    expect(replyToCopy({ ...base, action: 'accept' })).toBe(
      'From Fable:\n>>> Listed.'
    )
  })

  it('copies the reply Reject sends', () => {
    expect(replyToCopy({ ...base, action: 'reject' })).toBe(
      'From Fable:\n>>> Not this time.'
    )
  })

  it('copies nothing while Fable still writes the decline', () => {
    expect(
      replyToCopy({ ...base, action: 'reject', rejectReply: null })
    ).toBeNull()
  })

  it('copies nothing for set aside, other sources, or an answered request', () => {
    expect(replyToCopy({ ...base, action: 'later' })).toBeNull()
    expect(
      replyToCopy({ ...base, source: 'Email', action: 'accept' })
    ).toBeNull()
    expect(
      replyToCopy({ ...base, alreadyReplied: true, action: 'accept' })
    ).toBeNull()
    expect(
      replyToCopy({ ...base, shownReply: '  ', action: 'accept' })
    ).toBeNull()
  })
})
