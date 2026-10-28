import { expect, mock, test } from 'claude-code/testing'

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

const usage = {
  input_tokens: 1,
  output_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

test('a mistake shows in the pane and the prompt goes out as typed', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: '{"lang":"en","corrected":"I did the tests yesterday","notes":["\\"I have did\\" → \\"I did\\""]}',
      usage,
    },
  }))

  await $.prompt.submit({ text: 'I have did the tests yesterday' })
  await clock.settle()

  expect(sent).toEqual(['I have did the tests yesterday'])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /✓/ }))?.text).toBe('✓ I did the tests yesterday')
    expect((await ui.find({ type: 'Text', text: /checked/ }))?.text).toContain('1 checked · 0 perfect')
    await ui.unmount()
  }
})

test('Portuguese and short prompts add nothing', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
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
  expect((await ui.find({ type: 'Text', text: /No corrections/ }))?.text).toContain('No corrections yet')
  await ui.unmount()
})
