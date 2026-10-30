import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChatMessage, Chats, Correction, Kind, Note, Saved, View } from '../types'

const PANE = 'english-coach'
const KEEP = 200
// Each session's pane is kept under `session:<id>`, for the newest few sessions.
const PREFIX = 'session:'
const KEEP_SESSIONS = 100
// Long pastes are logs or code, not English practice.
const MAX_CHARS = 1500
// How many earlier messages go back to the tutor with each question.
const HISTORY = 20
// The Conversa tab's conversation; every other key is a correction's id.
const FREE = 'free'

const KINDS: Record<Kind, string> = {
  verb: 'verbo',
  preposition: 'preposição',
  article: 'artigo',
  pronoun: 'pronome',
  capitalization: 'maiúscula',
  'word-order': 'ordem',
  'word-choice': 'vocabulário',
  spelling: 'ortografia',
  other: 'outro',
}

const corrections = atom(
  { plugin: 'english-coach', key: 'corrections' } as const,
  [] as Correction[],
  { shape: 'corrections-1' },
)
const pending = atom({ plugin: 'english-coach', key: 'pending' } as const, [] as string[])
const view = atom({ plugin: 'english-coach', key: 'view' } as const, 'list' as View)
const discussing = atom({ plugin: 'english-coach', key: 'discussing' } as const, '')
const chats = atom({ plugin: 'english-coach', key: 'chats' } as const, {} as Chats, {
  shape: 'chats-1',
})
const drafts = atom({ plugin: 'english-coach', key: 'drafts' } as const, {} as Record<string, string>)
const replying = atom({ plugin: 'english-coach', key: 'replying' } as const, [] as string[])
const loadedFor = atom({ plugin: 'english-coach', key: 'loadedFor' } as const, '')

const SYSTEM = `You are an English tutor for a Brazilian Portuguese speaker who practices English by writing requests to a coding assistant.

You get one message the student wrote. Reply with JSON only, no prose, no code fence.

If the message is mostly not in English (for example Portuguese), reply {"lang":"other"}.

Otherwise reply {"lang":"en","corrected":"...","notes":[{"from":"...","to":"...","why":"...","kind":"..."}]}:
- "corrected": the message rewritten in correct, natural English, keeping the meaning, tone and every technical part (code, paths, commands, identifiers, product names) exactly as written.
- "notes": one per real mistake:
  - "from": the wrong words exactly as the student wrote them, as few as show the mistake (e.g. "travel"); "" when something is missing.
  - "to": what replaces them in "corrected" (e.g. "travels"); "" when they should go.
  - "why": the rule in Brazilian Portuguese, one short line of at most 60 characters, e.g. "he/she/it no presente simples: verbo + s".
  - "kind": one of verb, preposition, article, pronoun, capitalization, word-order, word-choice, spelling, other.
- Ignore casual-chat style: a lowercase first letter, a missing final period, missing commas a native would also skip, and informal but correct words.
- If there is no real mistake, "corrected" is the message unchanged and "notes" is [].`

const TUTOR = `You are a friendly English tutor for a Brazilian Portuguese speaker who practices English by writing requests to a coding assistant. The student talks to you in a small side panel: about a correction of their own English, or about anything in English (how to say something, word choice, grammar, pronunciation).

- Explain in Brazilian Portuguese; write the English examples in English.
- Put the answer itself in the first sentence, then the explanation.
- When asked how to say something in English, give the most natural way first, then up to 2 alternatives and when each fits.
- Keep it short: a few sentences, at most 3 examples. The panel is narrow.
- Plain text only: no Markdown, no headings, no tables, no code fences.
- If the student writes in English, briefly point out any real mistake in that message too, then answer.
- If the question is not about English, answer in one line and steer back to English.`

// A note as Haiku or an older version of this mod left it: a bare string
// before notes had parts.
function toNote(n: unknown): Note | undefined {
  if (typeof n === 'string') return n.trim() ? { from: '', to: '', why: n.trim(), kind: 'other' } : undefined
  if (!n || typeof n !== 'object') return undefined
  const v = n as Record<string, unknown>
  const text = (k: string) => (typeof v[k] === 'string' ? (v[k] as string).trim() : '')
  if (!text('from') && !text('to') && !text('why')) return undefined
  const kind = Object.hasOwn(KINDS, text('kind')) ? (text('kind') as Kind) : 'other'
  return { from: text('from'), to: text('to'), why: text('why'), kind }
}

const toCorrection = (c: Correction): Correction => ({
  ...c,
  notes: (Array.isArray(c.notes) ? (c.notes as unknown[]) : []).flatMap(n => toNote(n) ?? []),
})

type Verdict = { lang: 'other' } | { lang: 'en'; corrected: string; notes: Note[] }

function parse(reply: string): Verdict | undefined {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const v = JSON.parse(reply.slice(start, end + 1))
    if (v?.lang === 'other') return { lang: 'other' }
    if (v?.lang === 'en' && typeof v.corrected === 'string') {
      const notes = Array.isArray(v.notes) ? (v.notes as unknown[]).flatMap(n => toNote(n) ?? []) : []
      return { lang: 'en', corrected: v.corrected, notes }
    }
  } catch {}
  return undefined
}

const same = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ')

type Piece = { kind: 'same' | 'del' | 'add'; text: string }

// Word by word, the longest run both sentences share stays; what only the
// original has is a deletion, what only the correction has an addition.
function diffWords(a: string, b: string): Piece[] {
  const x = a.split(/\s+/).filter(Boolean)
  const y = b.split(/\s+/).filter(Boolean)
  const lcs = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0))
  const at = (i: number, j: number) => lcs[i]![j]!
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i]![j] = x[i] === y[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const out: Piece[] = []
  const push = (kind: Piece['kind'], text: string) => {
    const last = out[out.length - 1]
    if (last?.kind === kind) last.text += ` ${text}`
    else out.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      push('same', x[i]!)
      i += 1
      j += 1
    } else if (i < x.length && (j >= y.length || at(i + 1, j) >= at(i, j + 1))) {
      push('del', x[i]!)
      i += 1
    } else {
      push('add', y[j]!)
      j += 1
    }
  }
  return out
}

const cut = (s: string, n: number) => {
  const line = s.replace(/\s+/g, ' ').trim()
  return line.length > n ? `${line.slice(0, Math.max(1, n - 1))}…` : line
}

const newId = async ($: EngineInterface) =>
  `${await $.clock.now()}-${Math.random().toString(36).slice(2, 8)}`

async function save($: EngineInterface) {
  const id = await read($, loadedFor)
  if (!id) return
  const list = await read($, corrections)
  // A correction that left the list takes its conversation with it.
  const kept = new Set([FREE, ...list.map(c => c.id)])
  const all = await read($, chats)
  const saved: Saved = {
    corrections: list,
    chats: Object.fromEntries(Object.entries(all).filter(([key]) => kept.has(key))),
  }
  await $.store.set(PREFIX + id, saved)

  const known = await $.store.get('sessions')
  const ids = [...(Array.isArray(known) ? known.filter(k => typeof k === 'string' && k !== id) : []), id]
  for (const old of ids.slice(0, -KEEP_SESSIONS)) await $.store.delete(PREFIX + old)
  await $.store.set('sessions', ids.slice(-KEEP_SESSIONS))
}

// The pane shows the current session only: a new session or a /clear starts
// empty, a resume brings back what that session had.
async function follow($: EngineInterface) {
  const id = await $.session.id()
  if (id === (await read($, loadedFor))) return
  const saved = (await $.store.get(PREFIX + id)) as Partial<Saved> | undefined
  await update($, loadedFor, () => id)
  await update($, corrections, () =>
    Array.isArray(saved?.corrections) ? saved.corrections.map(toCorrection) : [],
  )
  await update($, chats, () => saved?.chats ?? {})
  await update($, drafts, () => ({}))
  await update($, view, () => 'list' as View)
  await update($, discussing, () => '')
}

async function check($: EngineInterface, text: string) {
  const id = await read($, loadedFor)
  await update($, pending, p => [...p, text])
  try {
    const r = await $.model.complete({ model: 'haiku', system: SYSTEM, prompt: text, maxTokens: 1200 })
    // A /clear while Haiku was answering: the prompt belongs to the old session.
    if (!r.isAnswered || (await read($, loadedFor)) !== id) return
    const verdict = parse(r.text)
    if (!verdict || verdict.lang === 'other') return

    if (verdict.notes.length > 0 && !same(verdict.corrected, text)) {
      const entry: Correction = {
        id: await newId($),
        at: await $.clock.now(),
        original: text,
        corrected: verdict.corrected,
        notes: verdict.notes,
      }
      await update($, corrections, list => [...list, entry].slice(-KEEP))
      await save($)
    }
  } finally {
    await update($, pending, p => {
      const i = p.indexOf(text)
      return i < 0 ? p : [...p.slice(0, i), ...p.slice(i + 1)]
    })
  }
}

function tutorPrompt(about: Correction | undefined, messages: ChatMessage[]): string {
  const parts: string[] = []
  if (about) {
    parts.push(
      'The conversation is about this correction:',
      `Original: ${about.original}`,
      `Corrected: ${about.corrected}`,
      ...about.notes.map(n => `Note: ${n.from || n.to ? `"${n.from}" → "${n.to}": ` : ''}${n.why}`),
      '',
    )
  }
  parts.push('Conversation so far:')
  for (const m of messages.filter(m => m.from !== 'error').slice(-HISTORY)) {
    parts.push(`${m.from === 'you' ? 'Student' : 'Tutor'}: ${m.text}`)
  }
  parts.push('', "Reply as the tutor to the student's last message.")
  return parts.join('\n')
}

async function scrollToEnd($: EngineInterface) {
  try {
    await $.ui.scroll({ to: 'end', in: PANE })
  } catch {}
}

const append = (key: string, m: ChatMessage) => (all: Chats) => ({
  ...all,
  [key]: [...(all[key] ?? []), m],
})

// Each conversation is its own Haiku call: nothing here reaches the main
// conversation, and the free chat never sees a correction.
async function ask($: EngineInterface, key: string, text: string) {
  const question = text.trim()
  if (!question) return
  const id = await read($, loadedFor)
  const about = key === FREE ? undefined : (await read($, corrections)).find(c => c.id === key)
  await update($, chats, append(key, { id: await newId($), from: 'you', text: question }))
  await update($, drafts, d => ({ ...d, [key]: '' }))
  await update($, replying, r => [...r, key])
  void scrollToEnd($)
  try {
    const r = await $.model.complete({
      model: 'haiku',
      system: TUTOR,
      prompt: tutorPrompt(about, (await read($, chats))[key] ?? []),
      maxTokens: 800,
      timeoutMs: 60000,
    })
    const answer: ChatMessage = r.isAnswered
      ? { id: await newId($), from: 'tutor', text: r.text.trim() }
      : { id: await newId($), from: 'error', text: `Sem resposta (${r.reason}).` }
    if ((await read($, loadedFor)) !== id) return
    await update($, chats, append(key, answer))
    await save($)
  } finally {
    await update($, replying, r => {
      const i = r.indexOf(key)
      return i < 0 ? r : [...r.slice(0, i), ...r.slice(i + 1)]
    })
    void scrollToEnd($)
  }
}

async function show($: EngineInterface, next: View, key: string) {
  if (next === 'discuss') await update($, discussing, () => key)
  await update($, view, () => next)
  try {
    await $.ui.focus({ requestId: PANE, key: `ask:${key}` })
  } catch {}
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await follow($)
    // A list kept by an earlier version of the mod gets notes with parts.
    await update($, corrections, list => list.map(toCorrection))
    await $.command.register({
      name: 'english',
      description: 'Show the English corrections pane',
    })

    return next(e)
  })

  on('command.run', { command: 'english' }, async $ => {
    await $.ui.open({ id: PANE, title: 'English' })

    return { text: 'English corrections pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    const isPractice =
      !e.command && !e.isMeta && text.length <= MAX_CHARS && text.split(/\s+/).length >= 3
    // The prompt goes out exactly as typed; the check runs beside the turn.
    // A failure here must never hold the prompt back.
    try {
      $.clock.after(0, () =>
        void follow($)
          .then(() => (isPractice ? check($, text) : undefined))
          .catch(() => {}),
      )
    } catch {}

    return next(e)
  })

  // A /clear or /resume goes on in this process under another session id,
  // with no session.start: switch the pane once the new id is in place.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      try {
        $.clock.after(0, () => void follow($).catch(() => {}))
      } catch {}
    }

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // Mobile draws no text field; the chat is read-only there.
    const Input = 'Input' in elements ? elements.Input : undefined
    const cols = Math.max(20, e.props.bodyColumns)
    const list = await read($, corrections)
    const checking = await read($, pending)
    const all = await read($, chats)
    const waiting = await read($, replying)
    const typed = await read($, drafts)

    let current = await read($, view)
    const target = current === 'discuss' ? await read($, discussing) : ''
    const about = list.find(c => c.id === target)
    // The correction under discussion was cleared away.
    if (current === 'discuss' && !about) current = 'list'
    // One-key presses only where no text field would take the key instead.
    const withKeys = current === 'list'

    const rule = <Text dimColor>{'─'.repeat(cols)}</Text>

    const tab = (key: string, label: string, hotkey: string, isActive: boolean, onPress: () => unknown) => (
      <Button key={key} plain {...(withKeys ? { hotkey } : {})} onPress={() => void onPress()}>
        {isActive ? (
          <Text inverse bold>
            {' '}
            {label}{' '}
          </Text>
        ) : (
          <Text dimColor>
            {' '}
            {label}{' '}
          </Text>
        )}
      </Button>
    )

    const header = (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Box gap={1}>
            {tab(
              'tab:list',
              list.length > 0 ? `Correções ${list.length}` : 'Correções',
              '1',
              current !== 'chat',
              () => update($, view, () => 'list' as View),
            )}
            {tab('tab:chat', 'Conversa', '2', current === 'chat', () => show($, 'chat', FREE))}
          </Box>
          {current === 'list' && list.length > 0 && (
            <Button
              key="clear"
              plain
              dimColor
              label="Limpar"
              onPress={async () => {
                await update($, corrections, () => [])
                await update($, chats, c => ({ [FREE]: c[FREE] ?? [] }))
                await save($)
              }}
            />
          )}
        </Box>
        {rule}
        {checking.length > 0 && (
          <Text dimColor wrap="truncate">
            ⋯ verificando “{cut(checking.at(-1) ?? '', cols - 16)}”
          </Text>
        )}
      </Box>
    )

    // The sentence once: removed words struck in red, added ones in green.
    // A sentence rewritten almost whole reads better as before and after.
    const sentence = (c: Correction) => {
      const pieces = diffWords(c.original, c.corrected)
      const kept = pieces.filter(p => p.kind === 'same').reduce((n, p) => n + p.text.split(' ').length, 0)
      const words = c.corrected.split(/\s+/).filter(Boolean).length
      if (kept < words / 3) {
        return (
          <Box flexDirection="column">
            <Text color="error" strikethrough>
              {c.original}
            </Text>
            <Text color="success">{c.corrected}</Text>
          </Box>
        )
      }
      return (
        <Text>
          {pieces.flatMap((p, i) => [
            i > 0 ? ' ' : '',
            p.kind === 'same' ? (
              p.text
            ) : p.kind === 'del' ? (
              <Text color="error" strikethrough>
                {p.text}
              </Text>
            ) : (
              <Text color="success" bold>
                {p.text}
              </Text>
            ),
          ])}
        </Text>
      )
    }

    const notes = (c: Correction) => (
      <Box flexDirection="column" marginTop={1}>
        {c.notes.map(n =>
          n.from || n.to ? (
            <Box flexDirection="column">
              <Text>
                <Text bold>
                  {n.from || '∅'} → {n.to || '∅'}
                </Text>
                <Text dimColor>  {KINDS[n.kind]}</Text>
              </Text>
              {n.why !== '' && (
                <Box marginLeft={2}>
                  <Text dimColor>{n.why}</Text>
                </Box>
              )}
            </Box>
          ) : (
            <Box>
              <Text dimColor>• </Text>
              <Box flexShrink={1}>
                <Text dimColor>{n.why}</Text>
              </Box>
            </Box>
          ),
        )}
      </Box>
    )

    const card = (c: Correction) => (
      <Box borderStyle="quote" borderDimColor flexDirection="column" paddingLeft={1}>
        {sentence(c)}
        {c.notes.length > 0 && notes(c)}
      </Box>
    )

    const conversation = (key: string, hint: string) => {
      const messages = all[key] ?? []
      return (
        <Box flexDirection="column">
          {messages.length === 0 && (
            <Box marginTop={1}>
              <Text dimColor>{hint}</Text>
            </Box>
          )}
          {messages.map(m =>
            m.from === 'you' ? (
              <Box key={m.id} justifyContent="flex-end" marginTop={1} marginLeft={4}>
                <Box borderStyle="round" borderDimColor paddingX={1}>
                  <Text>{m.text}</Text>
                </Box>
              </Box>
            ) : m.from === 'tutor' ? (
              <Box key={m.id} flexDirection="column" marginTop={1}>
                <Text color="suggestion" bold>
                  tutor
                </Text>
                <Text>{m.text}</Text>
              </Box>
            ) : (
              <Box key={m.id} marginTop={1}>
                <Text color="error">{m.text}</Text>
              </Box>
            ),
          )}
          {waiting.includes(key) && (
            <Box marginTop={1}>
              <Text dimColor>tutor está escrevendo…</Text>
            </Box>
          )}
          {Input && (
            <Box flexDirection="column" marginTop={1}>
              {rule}
              <Input
                key={`ask:${key}`}
                label="›"
                placeholder="sua pergunta…"
                submitLabel="enviar"
                value={typed[key] ?? ''}
                autoFocus
                onInput={(value: string) => void update($, drafts, d => ({ ...d, [key]: value }))}
                onSubmit={(value: string) => void ask($, key, value).catch(() => {})}
              />
            </Box>
          )}
        </Box>
      )
    }

    if (current === 'chat') {
      return (
        <Box flexDirection="column">
          {header}
          {(all[FREE] ?? []).length > 0 && (
            <Box justifyContent="flex-end">
              <Button
                key="new"
                plain
                dimColor
                label="Nova conversa"
                onPress={async () => {
                  await update($, chats, c => ({ ...c, [FREE]: [] }))
                  await save($)
                }}
              />
            </Box>
          )}
          {conversation(FREE, 'Quer saber como diz alguma coisa em inglês? Só perguntar.')}
        </Box>
      )
    }

    if (current === 'discuss' && about) {
      return (
        <Box flexDirection="column">
          {header}
          <Box marginBottom={1}>
            <Button
              key="back"
              plain
              dimColor
              label="← voltar"
              onPress={() => void update($, view, () => 'list' as View)}
            />
          </Box>
          {card(about)}
          {conversation(about.id, 'Pergunte o que quiser sobre essa correção.')}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {header}
        {list.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor>Nenhuma correção ainda. Escreva em inglês e elas aparecem aqui.</Text>
          </Box>
        )}
        {[...list].reverse().map((c, i) => {
          const asked = (all[c.id] ?? []).filter(m => m.from === 'you').length
          return (
            <Box key={c.id} flexDirection="column" marginTop={1}>
              {i > 0 && <Box marginBottom={1}>{rule}</Box>}
              <Box justifyContent="flex-end">
                <Button
                  key={`discuss:${c.id}`}
                  plain
                  // One hotkey can press one button: the newest correction's.
                  {...(i === 0 ? { hotkey: 'd' } : {})}
                  label={asked > 0 ? `Discutir (${asked}) ›` : 'Discutir ›'}
                  onPress={() => void show($, 'discuss', c.id)}
                />
              </Box>
              {card(c)}
            </Box>
          )
        })}
      </Box>
    )
  })
}
