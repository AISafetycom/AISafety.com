import { useSyncExternalStore, type ReactNode } from 'react'

// A page can hand the chatbot widget a strip of its own controls to show
// under the panel header while the panel is expanded (the /hire page puts its
// filter pills there, because the expanded panel's scrim covers the page's
// own filter bar). The page keeps owning the state: it re-publishes the
// element whenever that state changes, and the widget just renders it.
//
// Same shape as page-context.ts: a per-tab singleton in module scope, so the
// two React trees (page and widget) don't need a shared ancestor.

let current: ReactNode = null
const listeners = new Set<() => void>()

export function setAssistantPanelSlot(node: ReactNode): void {
  current = node
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ReactNode {
  return current
}

function getServerSnapshot(): ReactNode {
  return null
}

/** The element the current page wants inside the expanded panel, or null. */
export function useAssistantPanelSlot(): ReactNode {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
