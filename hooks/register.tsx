import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Correction, Stats } from '../types'

const PANE = 'english-coach'
const KEEP = 200
// Long pastes are logs or code, not English practice.
const MAX_CHARS = 1500

const corrections = atom(
  { plugin: 'english-coach', key: 'corrections' } as const,
  [] as Correction[],
  { shape: 'corrections-1' },
)
const stats = atom(
  { plugin: 'english-coach', key: 'stats' } as const,
  { checked: 0, perfect: 0 } as Stats,
  { shape: 'stats-1' },
)
const checking = atom({ plugin: 'english-coach', key: 'checking' } as const, 0)

const SYSTEM = `You are an English tutor for a Brazilian Portuguese speaker who practices English by writing requests to a coding assistant.

You get one message the student wrote. Reply with JSON only, no prose, no code fence.

If the message is mostly not in English (for example Portuguese), reply {"lang":"other"}.

Otherwise reply {"lang":"en","corrected":"...","notes":["..."]}:
- "corrected": the message rewritten in correct, natural English, keeping the meaning, tone and every technical part (code, paths, commands, identifiers, product names) exactly as written.
- "notes": one short note per real mistake, written in Brazilian Portuguese, quoting the English involved, e.g. "\\"I have did\\" → \\"I did\\": depois de have usa-se o particípio".
- Ignore casual-chat style: a lowercase first letter, a missing final period, missing commas a native would also skip, and informal but correct words.
- If there is no real mistake, "corrected" is the message unchanged and "notes" is [].`

type Verdict = { lang: 'other' } | { lang: 'en'; corrected: string; notes: string[] }

function parse(reply: string): Verdict | undefined {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const v = JSON.parse(reply.slice(start, end + 1))
    if (v?.lang === 'other') return { lang: 'other' }
    if (v?.lang === 'en' && typeof v.corrected === 'string') {
      const notes = Array.isArray(v.notes) ? v.notes.filter((n: unknown) => typeof n === 'string') : []
      return { lang: 'en', corrected: v.corrected, notes }
    }
  } catch {}
  return undefined
}

const same = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ')

async function save($: EngineInterface) {
  await $.store.set('corrections', await read($, corrections))
  await $.store.set('stats', await read($, stats))
}

async function check($: EngineInterface, text: string) {
  await update($, checking, n => n + 1)
  try {
    const r = await $.model.complete({ model: 'haiku', system: SYSTEM, prompt: text, maxTokens: 1200 })
    if (!r.isAnswered) return
    const verdict = parse(r.text)
    if (!verdict || verdict.lang === 'other') return

    const isPerfect = verdict.notes.length === 0 || same(verdict.corrected, text)
    await update($, stats, s => ({
      checked: s.checked + 1,
      perfect: s.perfect + (isPerfect ? 1 : 0),
    }))
    if (!isPerfect) {
      const at = await $.clock.now()
      const entry: Correction = {
        id: `${at}-${Math.random().toString(36).slice(2, 8)}`,
        at,
        original: text,
        corrected: verdict.corrected,
        notes: verdict.notes,
      }
      await update($, corrections, list => [...list, entry].slice(-KEEP))
    }
    await save($)
  } finally {
    await update($, checking, n => Math.max(0, n - 1))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The history lives in $.store so it carries over between sessions.
    if ((await read($, stats)).checked === 0) {
      const kept = await $.store.get('corrections')
      const counts = await $.store.get('stats')
      if (Array.isArray(kept)) await update($, corrections, () => kept as Correction[])
      if (counts && typeof counts === 'object') await update($, stats, () => counts as Stats)
    }
    await $.command.register({
      name: 'english',
      description: 'Show the English corrections pane',
    })
    void $.ui.open({ id: PANE, title: 'English' })

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
      if (isPractice) $.clock.after(0, () => void check($, text).catch(() => {}))
    } catch {}

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, corrections)
    const { checked, perfect } = await read($, stats)
    const pending = await read($, checking)

    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>
            {checked} checked · {perfect} perfect
            {pending > 0 ? ' · checking…' : ''}{' '}
          </Text>
          {list.length > 0 && (
            <Button
              key="clear"
              label="Clear"
              onPress={async () => {
                await update($, corrections, () => [])
                await update($, stats, () => ({ checked: 0, perfect: 0 }))
                await save($)
              }}
            />
          )}
        </Box>
        {list.length === 0 && (
          <Text dimColor>No corrections yet. Write in English and they show up here.</Text>
        )}
        {[...list].reverse().map(c => (
          <Box key={c.id} flexDirection="column" marginTop={1}>
            <Text color="error">✗ {c.original}</Text>
            <Text color="success">✓ {c.corrected}</Text>
            {c.notes.map(note => (
              <Text dimColor>  • {note}</Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
