import { describe, expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

const SUBMIT = { wait: false, origin: { kind: 'composer' as const } }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
const COMPOSE = { model: 'claude-fable-5-1', promptModel: 'claude-fable-5-1', surfaces: ['terminal' as const], tools: [], outputStyle: null, traits: [] }

/** The engine's own answers to what session.start registers. */
function bottoms(on: On): void {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
}

describe('contextlang in a session', () => {
  test('adds its lesson to the system prompt and a turn plan beside the prompt', async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: 1_000_000 })
    bottoms(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
    on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

    const composed = await $.prompt.compose(COMPOSE)
    const lesson = composed.sections.find(s => s.id === 'contextlang:lesson')
    expect(lesson).toBeDefined()
    expect(lesson?.scope).toBe('session')
    expect(lesson?.text).toContain('Spanish')

    const entered = await $.prompt.submit({ ...SUBMIT, text: 'Can you add a test for the parser?' })
    const note = entered.context?.find(c => c.startsWith('[ContextLang turn plan]'))
    expect(note).toBeDefined()
    expect(note).toContain('yes → **[sí]**')
    expect(note).toContain('ContextLang: ')
  })

  test('credits the final answer and persists progress across sessions', async ($, on) => {
    mock.store(on)
    const clock = mock.clock(on, { now: 1_000_000 })
    bottoms(on)
    on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

    await $.prompt.submit({ ...SUBMIT, text: 'hi' })
    await $.turn.complete({ answer: 'Got it! Yes [sí], I will start.\n\nContextLang: In Spanish, the vowels are short.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    const status = await $.command.run({ ...RUN, command: 'contextlang', args: 'status' })
    expect(status.text).toContain('Turns: 1 · Sessions: 1')
    expect(status.text).toContain('Sounds: 0/14')
    const words = await $.command.run({ ...RUN, command: 'contextlang', args: 'words' })
    expect(words.text).toContain('sí (yes, ×1)')

    await clock.advance(2 * 3600_000)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    const again = await $.command.run({ ...RUN, command: 'contextlang', args: 'status' })
    expect(again.text).toContain('Turns: 1 · Sessions: 2')
  })

  test('the report tool records use and forgotten words, and the command shows status', async ($, on) => {
    mock.store(on, {
      'progress:es': {
        version: 1, language: 'es', createdAt: 0, turns: 5, sessions: 1, lastSessionAt: 0,
        words: { hola: { t: 'hola', n: 'hello', stage: 'bare', box: 3, seen: 8, bareSeen: 1, produced: 0, misses: 0, dueTurn: 0, dueAt: 0, introducedTurn: 1 } },
        phrases: {}, alphabet: {}, script: {},
      },
    })
    mock.clock(on, { now: 1_000_000 })
    bottoms(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

    const ran = await $.tool.call({ tool: 'mcp__contextlang__report', used: [{ text: 'hola', correct: true }], forgot: ['hola'] })
    expect(ran.deny).toBeUndefined()
    expect(String(ran.result)).toContain('credited as used correctly: hola')
    expect(String(ran.result)).toContain('back to side by side: hola')
    const listed = await $.command.run({ ...RUN, command: 'contextlang', args: 'words' })
    expect(listed.text).toContain('Side by side (1)')
    expect(listed.text).toContain('used 1')

    const status = await $.command.run({ ...RUN, command: 'contextlang', args: '' })
    expect(status.text).toContain('Level')
    const words = await $.command.run({ ...RUN, command: 'contextlang', args: 'words' })
    expect(words.text).toContain('hola')
    const paused = await $.command.run({ ...RUN, command: 'contextlang', args: 'pause' })
    expect(paused.text).toContain('paused')
    const reset = await $.command.run({ ...RUN, command: 'contextlang', args: 'reset' })
    expect(reset.text).toContain('reset confirm')
  })

  test('progress is kept per language: a Russian learner does not inherit Spanish level', { options: { target_language: 'Russian' } }, async ($, on) => {
    mock.store(on, {
      'progress:es': {
        version: 1, language: 'es', createdAt: 0, turns: 40, sessions: 3, lastSessionAt: 0, levelOverride: 15,
        words: { hola: { t: 'hola', n: 'hello', stage: 'known', box: 6, seen: 8, bareSeen: 5, produced: 3, misses: 0, dueTurn: 0, dueAt: 0, introducedTurn: 1 } },
        phrases: {}, alphabet: {}, script: {},
      },
      'pack:ru': { words: [{ t: 'да', n: 'yes' }, { t: 'нет', n: 'no' }], phrases: [], alphabet: [] },
    })
    mock.clock(on, { now: 1_000_000 })
    bottoms(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    const status = await $.command.run({ ...RUN, command: 'contextlang', args: 'status' })
    expect(status.text).toContain('Russian')
    expect(status.text).toContain('Level **0.00** / 100')
    expect(status.text).toContain('Turns: 0 · Sessions: 1')
    expect(status.text).not.toContain('hola')
  })

  test('export writes the generated pack as a shipped-pack source file', { options: { target_language: 'Klingon' } }, async ($, on) => {
    mock.store(on, {
      'pack:klingon:en': { words: [{ t: 'HIja\'', n: 'yes' }, { t: 'ghobe\'', n: 'no' }], phrases: [{ t: 'nuqneH', n: 'what do you want', minLevel: 0 }], alphabet: [{ symbol: 'q', sound: 'deep in the throat' }] },
    })
    mock.clock(on, { now: 1_000_000 })
    bottoms(on)
    const written: { path: string; text: string }[] = []
    on('fs.write', (_, e) => {
      written.push({ path: e.path, text: e.text })
      return { value: undefined }
    })
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    const out = await $.command.run({ ...RUN, command: 'contextlang', args: 'export' })
    expect(out.text).toContain('Wrote 2 words, 1 phrases and 1 sound notes to contextlang-klingon.ts')
    expect(written.length).toBe(1)
    expect(written[0]?.path.endsWith('contextlang-klingon.ts')).toBe(true)
    expect(written[0]?.text).toContain('export const klingon: Pack = {')
    expect(written[0]?.text).toContain("{ t: 'HIja\\'', n: 'yes' },")
    const custom = await $.command.run({ ...RUN, command: 'contextlang', args: 'export packs/tlh.ts' })
    expect(custom.text).toContain('to packs/tlh.ts')
    expect(written[1]?.path.endsWith('packs/tlh.ts')).toBe(true)
  })

  test('a shipped language with nothing generated has nothing to export', async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: 1_000_000 })
    bottoms(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    const out = await $.command.run({ ...RUN, command: 'contextlang', args: 'export' })
    expect(out.text).toContain('nothing to export')
  })

  test('a misspelled language warns and waits a session before generating a pack', { options: { target_language: 'Russain', birth_date: 'forty-five' } }, async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: 1_000_000 })
    bottoms(on)
    const toasts: string[] = []
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    let modelCalls = 0
    on('session.model', () => ({ value: 'test-model' }))
    on('model.complete', () => {
      modelCalls += 1
      return { value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    })
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    expect(modelCalls).toBe(0)
    expect(toasts.some(t => t.includes('"Russain" is not a language') && t.includes('Did you mean Russian?'))).toBe(true)
    expect(toasts.some(t => t.includes('birth date "forty-five" is not readable'))).toBe(true)
    const status = await $.command.run({ ...RUN, command: 'contextlang', args: 'status' })
    expect(status.text).toContain('not a known language, did you mean Russian?')

    // Next session: the warning is not repeated, and the pack is generated (here the model is offline, so the attempt fails cleanly).
    toasts.length = 0
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    expect(modelCalls).toBeGreaterThan(0)
    expect(toasts.some(t => t.includes('is not a language'))).toBe(false)
    expect(toasts.some(t => t.includes('could not build the Russain pack'))).toBe(true)
  })

  test('does nothing when disabled', { options: { enabled: false } }, async ($, on) => {
    mock.store(on)
    mock.clock(on)
    bottoms(on)
    on('prompt.compose', () => ({ sections: [] }))
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    const composed = await $.prompt.compose(COMPOSE)
    expect(composed.sections.length).toBe(0)
  })
})
