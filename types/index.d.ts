// The kind of mistake a note is about, as Haiku classifies it.
export type Kind =
  | 'verb'
  | 'preposition'
  | 'article'
  | 'pronoun'
  | 'capitalization'
  | 'word-order'
  | 'word-choice'
  | 'spelling'
  | 'other'

// One mistake: the words as written, what replaces them, and the rule.
// A note kept from before notes had parts has only `why`.
export type Note = { from: string; to: string; why: string; kind: Kind }

export type Correction = {
  id: string
  at: number
  original: string
  corrected: string
  notes: Note[]
}

// `discuss` shows the conversation of the correction in `discussing`.
export type View = 'list' | 'chat' | 'discuss'

export type ChatMessage = { id: string; from: 'you' | 'tutor' | 'error'; text: string }

// One conversation per key: `free` for the Conversa tab, a correction's id
// for the conversation its Discutir opened.
export type Chats = Record<string, ChatMessage[]>

// What one Claude session keeps in $.store, under `session:<id>`.
export type Saved = { corrections: Correction[]; chats: Chats }

declare module 'claude-code' {
  interface PluginState {
    'english-coach': {
      corrections: Shaped<Correction[]>
      // The prompts Haiku is checking now, oldest first.
      pending: string[]
      view: View
      discussing: string
      chats: Shaped<Chats>
      // What each conversation's field holds, by the same keys as `chats`.
      drafts: Record<string, string>
      // The keys of the conversations waiting on the tutor, one per question.
      replying: string[]
      // The session id the pane shows; '' before the first load.
      loadedFor: string
    }
  }
}
