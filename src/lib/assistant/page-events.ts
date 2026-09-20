// Browser-side contract between a resource page and the chatbot widget. Both
// live in the same tab but are separate React trees (the widget is mounted
// once, site-wide), so they talk through window events instead of props.
//
//   page ──ASSISTANT_ASK_EVENT──▶ widget   "open, expand, and send this message"
//   widget ──ASSISTANT_TOOL_EVENT──▶ page  "the model just ran a tool"
//
// The page reads its own filter state back into the widget through
// setPageContext (page-context.ts); this file covers the other two directions.

export const ASSISTANT_ASK_EVENT = 'aisafety:assistant-ask'
export const ASSISTANT_TOOL_EVENT = 'aisafety:assistant-tool'

export interface AssistantAskDetail {
  message: string
  /** Open the widget in its expanded (centred) layout. */
  expand?: boolean
}

export interface AssistantToolDetail {
  name: string
  input: Record<string, unknown>
  ok: boolean
}

/** Ask the site chatbot something from page code (e.g. the /hire hero input). */
export function askAssistant(detail: AssistantAskDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ASSISTANT_ASK_EVENT, { detail }))
}

/** Announce a finished tool call to whichever page is listening. */
export function announceAssistantTool(detail: AssistantToolDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ASSISTANT_TOOL_EVENT, { detail }))
}
