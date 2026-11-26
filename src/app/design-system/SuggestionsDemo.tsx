'use client'

import { useState } from 'react'
import TextField from '@/components/TextField'

// The design system page's example of a text box with suggestions, as
// "Which listing?" in the correction form: type "a" to see the list, and
// something no suggestion has for the line that says so.
const SUGGESTIONS = [
  {
    value: 'AI Safety Quest',
    detail: 'Communities',
    logo: '/images/ai-safety-quest.png',
  },
  { value: 'Alignment Forum', detail: 'Media channels', logo: null },
  { value: 'ARENA', detail: 'Training programs', logo: null },
]

export default function SuggestionsDemo() {
  const [value, setValue] = useState('')
  return (
    <TextField
      label="Text box with suggestions"
      placeholder="Start typing a name"
      suggestions={SUGGESTIONS}
      onSuggestion={setValue}
      noSuggestions="No suggestion matches."
      value={value}
      onChange={e => setValue(e.target.value)}
    />
  )
}
