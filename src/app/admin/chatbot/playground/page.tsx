import { redirect } from 'next/navigation'
import { canViewPlayground } from '@/lib/admin/auth'
import { PRODUCTION_PROMPT, PROMPT_VERSION } from '@/lib/assistant/prompt'
import AssistantAdmin from '../AssistantAdmin'

export default async function PlaygroundPage() {
  // The section layout let us in on either chatbot tab; this page needs its own.
  if (!(await canViewPlayground())) redirect('/admin/chatbot/log')
  return (
    <AssistantAdmin
      productionPrompt={PRODUCTION_PROMPT}
      promptVersion={PROMPT_VERSION}
    />
  )
}
