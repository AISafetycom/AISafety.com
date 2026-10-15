// A Discord request's reply is pasted by hand: the Queue copies it with the
// decision and opens the conversation, Bryce sends it (14 Sept 2026: replies
// are drafts, never sent; 15 Oct 2026: "after I accept or reject … the
// message has been copied to clipboard … it could open the specific
// thread").

/** The Discord app's own link to the same conversation, so the reply is
 *  pasted where Bryce is signed in. Anything that is not a discord.com
 *  conversation link is left as it is. */
export function discordAppLink(url: string): string {
  const m =
    /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/(channels\/[^?#\s]+)/.exec(
      url
    )
  return m ? `discord://-/${m[1]}` : url
}

/** The reply that goes on the clipboard with a decision on a Discord
 *  request: for an accept, the reply as the page shows it; for a reject,
 *  the reply Reject sends (none when Fable still has to write it from a
 *  typed reason). None when they were already answered by hand. */
export function replyToCopy(opts: {
  source: string | null | undefined
  action: string
  alreadyReplied: boolean
  shownReply: string | null | undefined
  rejectReply: unknown
}): string | null {
  const { source, action, alreadyReplied, shownReply, rejectReply } = opts
  if (source !== 'Discord' || alreadyReplied) return null
  const text =
    action === 'accept'
      ? shownReply
      : action === 'reject' && typeof rejectReply === 'string'
        ? rejectReply
        : null
  return text?.trim() ? text : null
}
