import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'english-coach',
  component: 'Pane',
  requestId: 'english-coach',
  props: {
    title: 'English',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// $.session.id answers the id the test is in; each test starts in its own.
function inSession(on: On, id = 'test-session') {
  const at = { id }
  on('session.id', () => ({ value: at.id }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  return at
}

const usage = {
  input_tokens: 1,
  output_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

const VERDICT = JSON.stringify({
  lang: 'en',
  corrected: 'I did the tests yesterday',
  notes: [{ from: 'have did', to: 'did', why: 'passado simples sem have', kind: 'verb' }],
})

// Every text the drawing holds, nested ones included, in order.
const texts = (node: unknown): string[] => {
  if (typeof node === 'string') return [node]
  if (!node || typeof node !== 'object') return []
  const n = node as { text?: unknown; children?: unknown[]; props?: { label?: unknown } }
  return [
    ...(typeof n.props?.label === 'string' ? [n.props.label] : []),
    ...(Array.isArray(n.children) ? n.children.flatMap(texts) : typeof n.text === 'string' ? [n.text] : []),
  ]
}

test('a mistake shows once, struck and added, and the prompt goes out as typed', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  inSession(on)
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: VERDICT, usage } }))

  await $.prompt.submit({ text: 'I have did the tests yesterday' })
  await clock.settle()

  expect(sent).toEqual(['I have did the tests yesterday'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'have', strikethrough: true } as any)).toBeDefined()
    const drawn = texts(await ui.drawn()).join('')
    expect(drawn).toContain('have did → did')
    expect(drawn).toContain('verbo')
    expect(drawn).toContain('passado simples sem have')
    expect(drawn).toContain('Correções 1')
    await ui.unmount()
  }
})

test('Portuguese and short prompts add nothing', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  inSession(on)
  let calls = 0
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('model.complete', () => {
    calls += 1
    return { value: { isAnswered: true, text: '{"lang":"other"}', usage } }
  })

  await $.prompt.submit({ text: 'arruma esse bug pra mim' })
  await $.prompt.submit({ text: 'ok' })
  await clock.settle()

  expect(calls).toBe(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Nenhuma correção/ }))?.text).toContain('Nenhuma correção ainda')
  await ui.unmount()
})

test('every correction shows, with a line between each', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  inSession(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('model.complete', (_, e) => {
    const corrected = e.prompt.startsWith('she go') ? 'she goes to work' : 'I did the tests yesterday'
    const note = { from: 'x', to: 'y', why: `regra de ${corrected}`, kind: 'verb' }
    return { value: { isAnswered: true, text: JSON.stringify({ lang: 'en', corrected, notes: [note] }), usage } }
  })

  await $.prompt.submit({ text: 'I have did the tests yesterday' })
  await clock.settle()
  await $.prompt.submit({ text: 'she go to work' })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const drawn = texts(await ui.drawn())
  const newer = drawn.indexOf('regra de she goes to work')
  const older = drawn.indexOf('regra de I did the tests yesterday')
  expect(newer).toBeGreaterThan(-1)
  expect(older).toBeGreaterThan(newer)
  // The header's line, then one between the two corrections.
  expect(drawn.filter(t => t.startsWith('───')).length).toBe(2)
  expect(drawn.slice(newer, older).some(t => t.startsWith('───'))).toBe(true)
  await ui.unmount()
})

test('notes kept as plain strings by an earlier version still show', async ($, on) => {
  mock.store(on, {
    'session:test-session': {
      corrections: [
        {
          id: 'old-1',
          at: 0,
          original: 'i want more typ',
          corrected: 'I want more tips',
          notes: ['"typ" → "tips": ortografia'],
        },
      ],
      chats: {},
    },
  })
  const clock = mock.clock(on)
  inSession(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  // Too short to check: it only loads the session's pane.
  await $.prompt.submit({ text: 'ok' })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(texts(await ui.drawn()).join('')).toContain('"typ" → "tips": ortografia')
  await ui.unmount()
})

test('Discutir opens a conversation about that correction', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  inSession(on)
  const prompts: string[] = []
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('model.complete', (_, e) => {
    prompts.push(e.prompt)
    const text = !e.prompt.includes('Conversation so far')
      ? VERDICT
      : e.prompt.includes('Original:')
        ? 'Depois de "have" usa-se o particípio: "I have done".'
        : 'O mais natural é "I\'ll take a look".'
    return { value: { isAnswered: true, text, usage } }
  })

  await $.prompt.submit({ text: 'I have did the tests yesterday' })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const discuss = (await ui.find({ type: 'Button', text: /Discutir/ }))!.key!
  const correction = discuss.slice('discuss:'.length)
  await ui.press({ key: discuss })
  await ui.input({ key: `ask:${correction}`, text: 'por que não "have did"?' })
  await clock.settle()

  expect(prompts[1]).toContain('Original: I have did the tests yesterday')
  expect(prompts[1]).toContain('Note: "have did" → "did": passado simples sem have')
  expect(prompts[1]).toContain('Student: por que não "have did"?')
  expect(texts(await ui.drawn()).join('\n')).toContain('I have done')

  // Conversa is its own conversation: no correction drawn, none sent.
  await ui.press({ key: 'tab:chat' })
  let drawn = texts(await ui.drawn()).join('\n')
  expect(drawn).not.toContain('have did')
  expect(drawn).not.toContain('I have done')
  await ui.input({ key: 'ask:free', text: 'como falo "vou dar uma olhada"?' })
  await clock.settle()
  expect(prompts[2]).not.toContain('Original:')
  expect(prompts[2]).not.toContain('have did')
  expect(texts(await ui.drawn()).join('\n')).toContain("I'll take a look")

  // Back on the correction, its own conversation is still there.
  await ui.press({ key: 'tab:list' })
  expect((await ui.find({ key: discuss }))?.text).toContain('Discutir (1)')
  await ui.press({ key: discuss })
  drawn = texts(await ui.drawn()).join('\n')
  expect(drawn).toContain('I have done')
  expect(drawn).not.toContain("I'll take a look")
  await ui.unmount()

  const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(texts(await phone.drawn()).join('\n')).toContain('I have done')
  await phone.unmount()
})

test('each session has its own pane: /clear empties it, a resume brings it back', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const session = inSession(on, 'aaa')
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('model.complete', () => ({ value: { isAnswered: true, text: VERDICT, usage } }))
  const end = async (reason: 'clear' | 'resume', sessionId: string) => {
    await $.session.end({ reason, sessionId, resume: {} } as any)
    await clock.settle()
  }

  await $.prompt.submit({ text: 'I have did the tests yesterday' })
  await clock.settle()

  session.id = 'bbb'
  await end('clear', 'aaa')
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(texts(await ui.drawn()).join('')).not.toContain('yesterday')
  await ui.unmount()

  session.id = 'aaa'
  await end('resume', 'bbb')
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(texts(await ui.drawn()).join('')).toContain('yesterday')
  await ui.unmount()
})
