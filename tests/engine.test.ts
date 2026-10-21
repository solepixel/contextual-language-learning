import { describe, expect, test } from 'claude-code/testing'

import {
  ageAt,
  applyReport,
  bracketed,
  computeLevel,
  creditAnswer,
  detectForgotten,
  detectUsed,
  flippedLeads,
  formatFlipped,
  knowWord,
  lessonSection,
  makePlan,
  matchesForm,
  metScriptLetters,
  readableWith,
  scriptLetters,
  newProgress,
  parseBirthDate,
  readSettings,
  resetWord,
  settingsWarnings,
  statusText,
  styleExample,
  styleTarget,
  toastTimeout,
  tuning,
  turnNote,
} from '../hooks/engine'
import type { Settings } from '../hooks/engine'
import { es } from '../hooks/packs/es'
import { ru } from '../hooks/packs/ru'
import { generationEstimate, parseGenerated } from '../hooks/packs/generate'
import { resolveLanguage, basePack, SHIPPED, isKnownLanguage, suggestLanguage } from '../hooks/packs/index'
import { packSource } from '../hooks/packs/source'

const S: Settings = readSettings({})
const HOUR = 3600_000

/** A reply that carries every planned word the way the plan asks: side by side, flipped, or bare. */
function carry(plan: ReturnType<typeof makePlan>): string {
  return [...plan.annotate.map(w => `${w.n} [${w.t}]`), ...plan.flip.map(w => `*${w.t}* [${w.n}]`), ...plan.bare.map(w => `_${w.t}_`)].join(', ')
}

describe('settings and tuning', () => {
  test('defaults fill in and bad values fall back', async () => {
    const s = readSettings({ target_language: ' French ', pace: 'turbo', birth_date: 'yesterday', marker_style: 'bold', show_band: true })
    expect(s.target).toBe('French')
    expect(s.pace).toBe('steady')
    expect(s.birthDate).toBe('')
    expect(s.marker).toBe('bold')
    expect(s.showBand).toBe(true)
  })

  test('a birth date is normalised and age is derived from it on the day', async () => {
    const now = Date.UTC(2026, 9, 18) // 2026-10-18
    expect(parseBirthDate('1990-03-14', now)).toBe('1990-03-14')
    expect(parseBirthDate(' 1990-3-4 ', now)).toBe('1990-03-04')
    expect(parseBirthDate('2027-01-01', now)).toBe('')
    expect(parseBirthDate('1990-02-30', now)).toBe('')
    expect(parseBirthDate(12, now)).toBe('')
    expect(ageAt('', now)).toBe(0)
    expect(ageAt('1990-10-18', now)).toBe(36)
    expect(ageAt('1990-10-19', now)).toBe(35)
    expect(ageAt('2000-02-29', Date.UTC(2027, 1, 28))).toBe(26)
    expect(ageAt('2000-02-29', Date.UTC(2027, 2, 1))).toBe(27)
  })

  test('young and old learners get more repetition and a lighter density', async () => {
    const now = Date.UTC(2026, 9, 18)
    const adult = tuning({ ...S, birthDate: '1996-05-01' }, now)
    const child = tuning({ ...S, birthDate: '2018-05-01' }, now)
    const elder = tuning({ ...S, birthDate: '1956-05-01' }, now)
    expect(child.density).toBeLessThan(adult.density)
    expect(elder.density).toBeLessThan(adult.density)
    expect(child.promoteAfter).toBeGreaterThan(adult.promoteAfter)
    expect(tuning({ ...S, pace: 'brisk' }, now).density).toBeGreaterThan(adult.density)
    // The same learner ages into the next band without touching the setting.
    const later = Date.UTC(2034, 9, 18) // the child is 16 by then
    expect(tuning({ ...S, birthDate: '2018-05-01' }, later).density).toBe(tuning({ ...S, birthDate: '1996-05-01' }, now).density * 0.85)
  })
})

describe('planning', () => {
  test('a fresh learner gets one side-by-side word and a sounds footer', async () => {
    const p = newProgress('es', 0)
    const plan = makePlan(p, es, S, 0)
    expect(plan.turn).toBe(1)
    expect(plan.annotate.length).toBe(1)
    expect(plan.annotate[0]?.t).toBe('sí')
    expect(plan.bare.length).toBe(0)
    expect(plan.footer?.kind).toBe('alphabet')
    expect(Object.keys(p.words)).toEqual(['sí'])
    const plan2 = makePlan(p, es, S, 0)
    expect(plan2.annotate.length).toBeLessThanOrEqual(2)
  })

  test('tech words wait for level 25', async () => {
    const p = newProgress('es', 0)
    for (let i = 0; i < 40; i += 1) {
      const plan = makePlan(p, es, S, i * HOUR * 24)
      creditAnswer(p, plan, carry(plan) + '\n\nContextLang: x', S, i * HOUR * 24)
    }
    expect(Object.keys(p.words).some(t => es.words.find(w => w.t === t)?.tier === 'tech')).toBe(false)
    p.levelOverride = 30
    for (let i = 40; i < 80; i += 1) {
      const plan = makePlan(p, es, S, i * HOUR * 24)
      creditAnswer(p, plan, carry(plan), S, i * HOUR * 24)
    }
    expect(Object.keys(p.words).some(t => es.words.find(w => w.t === t)?.tier === 'tech')).toBe(true)
  })

  test('density grows with level', async () => {
    const low = newProgress('es', 0)
    const high = newProgress('es', 0)
    high.levelOverride = 40
    expect(makePlan(high, es, S, 0).annotate.length).toBeGreaterThan(makePlan(low, es, S, 0).annotate.length)
  })
})

describe('crediting the reply', () => {
  test('marked words are credited, code is ignored, and words flip and then go bare after enough spaced exposures', async () => {
    const p = newProgress('es', 0)
    const tune = tuning(S)
    let now = 0
    let flippedAt = -1
    let promotedAt = -1
    let seenFlipped = false
    for (let i = 0; i < 300; i += 1) {
      now += 24 * HOUR
      const plan = makePlan(p, es, S, now)
      if (plan.flip.some(w => w.t === 'sí')) seenFlipped = true
      const reply = carry(plan) + '\n```js\nconst x = "[gracias]"\n```\n' + (plan.footer ? `\nContextLang: ${plan.footer.text}` : '')
      const credit = creditAnswer(p, plan, reply, S, now)
      const planned = [...plan.annotate, ...plan.flip].map(w => w.t)
      for (const t of credit.annotated) expect(planned).toContain(t)
      if (credit.flipped.includes('sí') && flippedAt < 0) flippedAt = i
      if (credit.promoted.includes('sí') && promotedAt < 0) promotedAt = i
    }
    const si = p.words['sí']
    expect(si).toBeDefined()
    expect(si?.stage === 'bare' || si?.stage === 'known').toBe(true)
    expect(si?.seen).toBeGreaterThanOrEqual(tune.promoteAfter)
    // Spaced encounters only: at a reply a day the first word flips after some weeks and goes bare months in.
    expect(flippedAt).toBeGreaterThan(30)
    expect(flippedAt).toBeLessThan(promotedAt)
    expect(promotedAt).toBeGreaterThan(100)
    expect(seenFlipped).toBe(true)
    expect(p.turns).toBe(300)
  })

  test('an encounter before the spacing has elapsed is shown but not counted', async () => {
    const p = newProgress('es', 0)
    const plan1 = makePlan(p, es, S, 0)
    creditAnswer(p, plan1, 'yes [sí]', S, 0)
    const w = p.words['sí']!
    expect(w.seen).toBe(1)
    // Same hour, ten turns on, marked in every reply: it earns nothing until its spacing has elapsed.
    for (let turn = 2; turn <= 10; turn++) creditAnswer(p, makePlan(p, es, S, 0), 'yes [sí]', S, 0)
    expect(w.seen).toBe(1)
    creditAnswer(p, makePlan(p, es, S, 9 * HOUR), 'yes [sí]', S, 9 * HOUR)
    expect(w.seen).toBe(2)
  })

  test('a flipped word is credited when written word first, and only then', async () => {
    const p = newProgress('es', 0)
    const tune = tuning(S)
    p.words['sí'] = { t: 'sí', n: 'yes', stage: 'flipped', box: 2, seen: tune.flipAfter, bareSeen: 0, produced: 0, misses: 0, dueTurn: 0, dueAt: 0, introducedTurn: 1 }
    const plan = makePlan(p, es, S, 0)
    expect(plan.flip.map(w => w.t)).toContain('sí')
    expect(plan.annotate.map(w => w.t)).not.toContain('sí')
    const credit = creditAnswer(p, plan, 'Then *sí* **[yes]**, and we move on.', S, 0)
    expect(credit.annotated).toContain('sí')
    expect(p.words['sí']?.seen).toBe(tune.flipAfter + 1)
    expect(p.words['sí']?.stage).toBe('flipped')
    // A side-by-side word is not read as the lead of the bracket after it.
    expect(flippedLeads('yes **[sí]** and hello **[hola]**')).toEqual(['yes', 'and hello', 'hello'])
    expect(flippedLeads('*sí* **[yes]**\nhello [hola]')).toEqual(['sí', 'hello'])
    expect(flippedLeads('see [the docs](https://x) and *por favor* [please]')).toEqual(['and por favor', 'por favor', 'favor'])
    expect(formatFlipped('да', 'yes', S, 'da')).toBe('*да* **[yes, da]**')
  })

  test('saying you know a flipped word takes it straight to bare', async () => {
    const p = newProgress('es', 0)
    p.words['sí'] = { t: 'sí', n: 'yes', stage: 'flipped', box: 2, seen: 4, bareSeen: 0, produced: 0, misses: 0, dueTurn: 0, dueAt: 0, introducedTurn: 1 }
    knowWord(p.words['sí']!, 1, 0)
    expect(p.words['sí']?.stage).toBe('bare')
  })

  test('a word is not due again the same day once it is past its first box', async () => {
    const p = newProgress('es', 0)
    const plan1 = makePlan(p, es, S, 0)
    creditAnswer(p, plan1, 'yes [sí]', S, 0)
    const w = p.words['sí']
    expect(w?.dueTurn).toBe(3)
    expect(w?.dueAt).toBe(8 * HOUR)
    w!.box = 3
    creditAnswer(p, { ...plan1, turn: 3 }, 'yes [sí]', S, 8 * HOUR)
    expect(w?.dueAt).toBe(80 * HOUR)
  })

  test('bare words are credited when they appear plainly, and become known', async () => {
    const p = newProgress('es', 0)
    p.words['hola'] = { t: 'hola', n: 'hello', stage: 'bare', box: 2, seen: 8, bareSeen: 0, produced: 0, misses: 0, dueTurn: 0, dueAt: 0, introducedTurn: 1 }
    let now = 0
    for (let i = 0; i < 80; i += 1) {
      now += 48 * HOUR
      const plan = makePlan(p, es, S, now)
      if (plan.bare.some(b => b.t === 'hola')) creditAnswer(p, plan, '_Hola_! Here is the plan.', S, now)
      else creditAnswer(p, plan, 'nothing today', S, now)
    }
    expect(p.words['hola']?.stage).toBe('known')
  })

  test('markdown links and list numbers are not read as markers', async () => {
    expect(bracketed('see [the docs](https://x) and [1] and well [bien]')).toEqual(['1', 'bien'])
  })

  test('inflections match the dictionary form', async () => {
    expect(matchesForm('preguntas', 'pregunta')).toBe(true)
    expect(matchesForm('**[Preguntas]**', 'pregunta')).toBe(true)
    expect(matchesForm('nueva', 'nuevo')).toBe(true)
    expect(matchesForm('respuesta', 'pregunta')).toBe(false)
    expect(matchesForm('no', 'nota')).toBe(false)
  })

  test('the footer only counts when the reply carries the ContextLang line', async () => {
    const p = newProgress('es', 0)
    const plan = makePlan(p, es, S, 0)
    creditAnswer(p, plan, 'yes [sí]', S, 0)
    expect(Object.keys(p.alphabet).length).toBe(0)
    const plan2 = makePlan(p, es, S, 0)
    creditAnswer(p, plan2, `yes [sí]\n\n**ContextLang:** ${plan2.footer?.text}`, S, 0)
    expect(Object.keys(p.alphabet).length).toBe(1)
  })
})

describe('the learner writes Spanish', () => {
  test('correct use counts as production, mistakes pull the word back, forgetting resets it', async () => {
    const p = newProgress('es', 0)
    p.words['gracias'] = { t: 'gracias', n: 'thanks', stage: 'known', box: 5, seen: 8, bareSeen: 5, produced: 0, misses: 0, dueTurn: 0, dueAt: 0, introducedTurn: 1 }
    p.words['pregunta'] = { t: 'pregunta', n: 'question', stage: 'bare', box: 3, seen: 8, bareSeen: 1, produced: 0, misses: 0, dueTurn: 0, dueAt: 0, introducedTurn: 1 }
    const out = applyReport(p, es, [{ text: 'gracias', correct: true }, { text: 'una preguntas', correct: false }], ['hola'], 0)
    expect(out.credited).toEqual(['gracias'])
    expect(p.words['gracias']?.produced).toBe(1)
    expect(out.missed).toEqual(['pregunta'])
    expect(p.words['pregunta']?.misses).toBe(1)
    expect(out.forgot).toEqual(['hola'])
    expect(p.words['hola']?.stage).toBe('annotated')
    const g = p.words['gracias']!
    g.stage = 'bare'
    resetWord(g, 1, 0)
    expect(g.stage).toBe('annotated')
    expect(g.seen).toBe(4)
  })

  test('the prompt itself reveals forgotten and used words', async () => {
    const p = newProgress('es', 0)
    p.words['ahora'] = { t: 'ahora', n: 'now', stage: 'bare', box: 3, seen: 8, bareSeen: 1, produced: 0, misses: 0, dueTurn: 0, dueAt: 0, introducedTurn: 1 }
    p.words['hola'] = { t: 'hola', n: 'hello', stage: 'bare', box: 3, seen: 8, bareSeen: 1, produced: 0, misses: 0, dueTurn: 0, dueAt: 0, introducedTurn: 1 }
    expect(detectForgotten('hola! wait, what does "ahora" mean?', p)).toEqual(['ahora'])
    expect(detectForgotten('ahora please fix the bug', p)).toEqual([])
    expect(detectUsed('Hola, can you fix it ahora? `hola` in code does not count', p).sort()).toEqual(['ahora', 'hola'])
  })
})

describe('level and prompt text', () => {
  test('level rises with mastery, stays within 0..100, and the phase follows it', async () => {
    const p = newProgress('es', 0)
    const start = computeLevel(p, es, S)
    expect(start.level).toBe(0)
    expect(start.phase).toBe('sounds')
    for (const w of es.words.slice(0, 200)) p.words[w.t] = { t: w.t, n: w.n, stage: 'known', box: 6, seen: 8, bareSeen: 5, produced: 2, misses: 0, dueTurn: 0, dueAt: 0, introducedTurn: 1 }
    const later = computeLevel(p, es, S)
    expect(later.level).toBeGreaterThan(15)
    expect(later.level).toBeLessThan(40)
    expect(later.phase).toBe('phrases')
    p.levelOverride = 95
    expect(computeLevel(p, es, S).phase).toBe('fluent')
  })

  test('a Japanese learner starts in the script phase', async () => {
    const { pack } = basePack(resolveLanguage('Japanese'))
    const p = newProgress('ja', 0)
    expect(pack.script).toBe('kana')
    expect(computeLevel(p, pack, S).phase).toBe('script')
    const plan = makePlan(p, pack, S, 0)
    expect(plan.footer?.kind).toBe('script')
    expect(plan.footer?.key.split('|').length).toBe(1)
  })

  test('in the script phase a word only arrives once its letters have been taught', async () => {
    const { pack } = basePack(resolveLanguage('Russian'))
    const p = newProgress('ru', 0)
    const wordsSeen: string[] = []
    // Letters arrive every few replies now, so it takes a couple of months of daily replies to reach Д.
    for (let i = 0; i < 60; i++) {
      const now = i * HOUR * 24
      const plan = makePlan(p, pack, S, now)
      const met = metScriptLetters(p, pack)!
      for (const w of plan.annotate) {
        expect(readableWith(w.t, met, 'cyrillic')).toBe(true)
        if (!wordsSeen.includes(w.t)) wordsSeen.push(w.t)
      }
      creditAnswer(p, plan, carry(plan) + '\n\nContextLang: ' + plan.footer!.text, S, now)
    }
    // The very first reply has no letters yet, so no word; "да" needs only А and Д and comes once Д has.
    expect(wordsSeen.length).toBeGreaterThan(0)
    expect(wordsSeen).toContain('да')
    expect(wordsSeen).not.toContain('привет')
    const first = makePlan(newProgress('ru', 0), pack, S, 0)
    expect(first.annotate.length).toBe(0)
  })

  test('letters decompose the way the script lesson teaches them', async () => {
    expect(scriptLetters('강', 'hangul')).toEqual(['ㄱ', 'ㅏ', 'ㅇ'])
    expect(scriptLetters('왜', 'hangul')).toEqual(['ㅇ', 'ㅗ', 'ㅏ', 'ㅣ'])
    expect(scriptLetters('が', 'kana')).toEqual(['か'])
    expect(scriptLetters('ょ', 'kana')).toEqual(['よ'])
    expect(readableWith('나', new Set(['ㄴ', 'ㅏ']), 'hangul')).toBe(true)
    expect(readableWith('강', new Set(['ㄱ', 'ㅏ']), 'hangul')).toBe(false)
    expect(readableWith('ありがとう', new Set([...'ありかとう']), 'kana')).toBe(true)
    expect(readableWith('今日', new Set([...'きょう']), 'kana')).toBe(false)
    expect(readableWith('да!', new Set(['д', 'а', 'Д', 'А']), 'cyrillic')).toBe(true)
  })

  test('the script lesson introduces one new letter at a time, only while few are still being learned', async () => {
    const { pack } = basePack(resolveLanguage('Russian'))
    const p = newProgress('ru', 0)
    const tune = tuning(S)
    const seenNew: string[] = []
    let scriptFooters = 0
    for (let i = 0; i < 60; i++) {
      const now = i * HOUR * 24
      const inFlight = Object.values(p.script).filter(st => st.seen > 0 && st.seen < tune.scriptReps).length
      const plan = makePlan(p, pack, S, now)
      if (plan.footer?.kind !== 'script') {
        // Nothing due and no room for a new letter: the footer is a sound note or a phrase with its reading, never empty.
        expect(plan.footer?.kind === 'alphabet' || plan.footer?.kind === 'phrase').toBe(true)
        creditAnswer(p, plan, 'ok\n\nContextLang: ' + plan.footer!.text, S, now)
        continue
      }
      scriptFooters += 1
      const keys = plan.footer.key.split('|')
      const fresh = keys.filter(k => !seenNew.includes(k))
      expect(fresh.length).toBeLessThanOrEqual(1)
      expect(keys.length).toBeLessThanOrEqual(2)
      if (fresh.length > 0) expect(inFlight).toBeLessThan(tune.scriptInFlight)
      // Only the new letter carries its example word; a letter back for review is just the sound.
      expect((plan.footer.text.match(/", as in /g) ?? []).length).toBe(fresh.length)
      seenNew.push(...fresh)
      creditAnswer(p, plan, 'ok\n\nContextLang: ' + plan.footer.text, S, now)
    }
    // Sixty daily replies at the steady pace: roughly a letter every four or five replies, not one per reply.
    expect(seenNew.length).toBeGreaterThanOrEqual(8)
    expect(seenNew.length).toBeLessThanOrEqual(16)
    expect(scriptFooters).toBeGreaterThan(30)
    expect(seenNew[0]).toBe('А а')
  })

  test('the lesson and the turn note say what the model must do', async () => {
    const p = newProgress('es', 0)
    const plan = makePlan(p, es, S, 0)
    const lesson = lessonSection(es, p, S, computeLevel(p, es, S))
    expect(lesson).toContain('questions **[preguntas]**')
    expect(lessonSection(es, newProgress('es', 0), { ...S, marker: 'brackets' }, computeLevel(newProgress('es', 0), es, S)).replace(/\s+/g, ' ')).toContain('questions [preguntas]')
    expect(lesson).toContain('mcp__contextlang__report')
    expect(lesson).toContain('Only in the final reply')
    expect(lesson).toContain('Never in anything written for the person to send or publish as their own')
    expect(lesson).toContain('drafted email, Slack or chat message, GitHub comment')
    const note = turnNote(plan, es, S, ['hola'], ['ahora'])
    expect(note).toContain('[ContextLang turn plan]')
    expect(note).toContain('yes → **[sí]**')
    expect(note).toContain('ContextLang: ')
    expect(note).toContain('hola')
    expect(note).toContain('ahora')
    const bold = turnNote(plan, es, { ...S, marker: 'bold' }, [], [])
    expect(bold).toContain('**[sí]**')
    expect(turnNote(plan, es, { ...S, marker: 'italic' }, [], [])).toContain('*[sí]*')
    expect(turnNote(plan, es, { ...S, marker: 'code' }, [], [])).toContain('`[sí]`')
    // A flipped word is spelled out the other way round, and is not offered as a free bare word.
    expect(lesson).toContain('*preguntas* **[questions]**')
    p.words['hola'] = { t: 'hola', n: 'hello', stage: 'flipped', box: 2, seen: tuning(S).flipAfter, bareSeen: 0, produced: 0, misses: 0, dueTurn: 0, dueAt: 0, introducedTurn: 1 }
    p.words['gracias'] = { t: 'gracias', n: 'thanks', stage: 'bare', box: 2, seen: 8, bareSeen: 0, produced: 0, misses: 0, dueTurn: 0, dueAt: 0, introducedTurn: 1 }
    const later = lessonSection(es, p, S, computeLevel(p, es, S))
    expect(later).toContain('Use any of these bare, whenever their meaning comes up: gracias.')
    const plan2 = makePlan(p, es, S, 0)
    expect(turnNote(plan2, es, S, [], [])).toContain('Flipped (the Spanish word in italics, then the English word in square brackets, the whole bracket in bold), where the meaning naturally occurs: hello → *hola* **[hello]**')
    expect(statusText(es, p, S, computeLevel(p, es, S), 0)).toContain('1 flipped')
  })
})

describe('toasts', () => {
  test('a toast stays long enough to read: eight seconds at least, twenty at most, scaling with the text', () => {
    expect(toastTimeout('ContextLang: hola now comes first.')).toBe(8000)
    expect(toastTimeout('x'.repeat(240))).toBe(12_000)
    expect(toastTimeout('x'.repeat(1000))).toBe(20_000)
  })
})

describe('footer styling', () => {
  test('target-language words in a footer carry the marker style without brackets', async () => {
    const bold = { ...S, marker: 'bold' as const }
    expect(styleTarget('gracias', bold)).toBe('**gracias**')
    expect(styleTarget('gracias', { ...S, marker: 'brackets' })).toBe('gracias')
    expect(styleExample('año (year), mañana (tomorrow)', bold)).toBe('**año** (year), **mañana** (tomorrow)')
    expect(styleExample('hola is "oh-la", hecho is "eh-cho"', bold)).toBe('**hola** is "oh-la", **hecho** is "eh-cho"')
    expect(styleExample('casa, mesa, sí', bold)).toBe('**casa**, **mesa**, **sí**')
    expect(styleExample('らく (raku, easy)', { ...S, marker: 'italic' })).toBe('*らく* (raku, easy)')
    expect(styleExample('vous avez is "voo-za-vay"', { ...S, marker: 'code' })).toBe('`vous avez` is "voo-za-vay"')
    expect(styleExample('año (year), mañana (tomorrow)', { ...S, marker: 'brackets' })).toBe('año (year), mañana (tomorrow)')
    const p = newProgress('es', 0)
    const plan = makePlan(p, es, bold, 0)
    expect(plan.footer?.text).toContain('**casa**')
  })
})

describe('settings feedback', () => {
  test('a misspelled language and an unreadable birth date are pointed out, not silently dropped', async () => {
    const s = readSettings({ target_language: 'Russain', birth_date: '45' })
    expect(s.birthDate).toBe('')
    expect(s.birthDateRaw).toBe('45')
    const warnings = settingsWarnings(s, { known: false, suggestion: 'Russian' })
    expect(warnings.length).toBe(2)
    expect(warnings[0]).toContain('"Russain" is not a language')
    expect(warnings[0]).toContain('Did you mean Russian?')
    expect(warnings[1]).toContain('birth date "45" is not readable')
    expect(settingsWarnings(readSettings({ target_language: 'Russian', birth_date: '1981-09-24' }), { known: true })).toEqual([])
    expect(settingsWarnings(readSettings({}), { known: true })).toEqual([])
  })

  test('status echoes every setting as the plugin read it', async () => {
    const now = Date.UTC(2026, 9, 19)
    const good = readSettings({ target_language: 'russian', birth_date: '1981/09/24', pace: 'brisk', marker_style: 'code' })
    const text = statusText(ru, newProgress('ru', 0), good, computeLevel(newProgress('ru', 0), ru, good, now), now, { isShipped: true, known: true })
    expect(text).toContain('Settings as read: learn russian → Russian (ru, shipped pack) · from English · birth date 1981-09-24 (age 45) · pace brisk · marker code · pack model claude-sonnet-5-5')
    const bad = readSettings({ target_language: 'Russain', birth_date: '45' })
    const { pack } = basePack(resolveLanguage('Russain'))
    const text2 = statusText(pack, newProgress('russain', 0), bad, computeLevel(newProgress('russain', 0), pack, bad, now), now, { isShipped: false, known: false, suggestion: 'Russian' })
    expect(text2).toContain('(russain, not a known language, did you mean Russian?)')
    expect(text2).toContain('birth date "45" is not readable, use YYYY-MM-DD')
    const unset = readSettings({})
    expect(statusText(es, newProgress('es', 0), unset, computeLevel(newProgress('es', 0), es, unset, now), now)).toContain('birth date not set')
  })
})

describe('packs', () => {
  test('language names resolve and the Spanish pack has no duplicate keys', async () => {
    expect(resolveLanguage('spanish').code).toBe('es')
    expect(resolveLanguage('Español').code).toBe('es')
    expect(resolveLanguage('Korean').nativeName).toBe('한국어')
    expect(resolveLanguage('Klingon').code).toBe('klingon')
    expect(isKnownLanguage('Russian')).toBe(true)
    expect(isKnownLanguage('ru')).toBe(true)
    expect(isKnownLanguage('Russain')).toBe(false)
    expect(suggestLanguage('Russain')).toBe('Russian')
    expect(suggestLanguage('Japnese')).toBe('Japanese')
    expect(suggestLanguage('Klingon')).toBeUndefined()
    expect(suggestLanguage('Russian')).toBeUndefined()
    const keys = es.words.map(w => w.t)
    expect(new Set(keys).size).toBe(keys.length)
    expect(es.words.length).toBeGreaterThan(400)
  })

  test('the Russian pack has no duplicate keys and every entry carries a reading', async () => {
    const keys = ru.words.map(w => w.t.toLowerCase())
    expect(new Set(keys).size).toBe(keys.length)
    expect(ru.words.length).toBeGreaterThan(400)
    expect(ru.words.every(w => typeof w.reading === 'string' && w.reading.length > 0)).toBe(true)
    expect(ru.phrases.every(p => typeof p.reading === 'string' && p.reading.length > 0)).toBe(true)
    const phraseKeys = ru.phrases.map(p => p.t.toLowerCase())
    expect(new Set(phraseKeys).size).toBe(phraseKeys.length)
    expect(ru.scriptItems?.length).toBe(33)
  })

  test('every shipped pack is well formed: unique keys, over 400 words, readings where the script needs them', async () => {
    expect(SHIPPED.map(p => p.code).sort()).toEqual(['de', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'ru', 'zh'])
    for (const p of SHIPPED) {
      expect(p.native).toBe('en')
      expect(resolveLanguage(p.name).code).toBe(p.code)
      const keys = p.words.map(w => w.t.toLowerCase())
      expect(new Set(keys).size, `${p.code} duplicate words`).toBe(keys.length)
      expect(p.words.length, `${p.code} word count`).toBeGreaterThan(400)
      const phraseKeys = p.phrases.map(x => x.t.toLowerCase())
      expect(new Set(phraseKeys).size, `${p.code} duplicate phrases`).toBe(phraseKeys.length)
      expect(p.phrases.length, `${p.code} phrase count`).toBeGreaterThan(30)
      expect(p.alphabet.length, `${p.code} sound notes`).toBeGreaterThan(8)
      expect(p.words.filter(w => w.tier === 'tech').length, `${p.code} tech words`).toBeGreaterThan(30)
      expect(p.words.filter(w => w.tier === 'deep').length, `${p.code} deep words`).toBeGreaterThan(10)
      expect(p.words.every(w => w.t.trim() === w.t && w.n.trim() === w.n && w.t.length > 0 && w.n.length > 0), `${p.code} blank or padded entry`).toBe(true)
      expect(p.words.every(w => (w.note ?? '').length <= 120), `${p.code} note over 120 chars`).toBe(true)
      expect(p.phrases.every(x => x.minLevel >= 0 && x.minLevel <= 40), `${p.code} phrase level`).toBe(true)
      if (p.script !== 'latin') {
        expect(p.words.every(w => typeof w.reading === 'string' && w.reading.length > 0), `${p.code} word without reading`).toBe(true)
        expect(p.phrases.every(x => typeof x.reading === 'string' && x.reading.length > 0), `${p.code} phrase without reading`).toBe(true)
        expect((p.scriptItems ?? []).length, `${p.code} script items`).toBeGreaterThan(0)
      } else {
        expect(p.scriptItems).toBeUndefined()
      }
    }
  })

  test('a shipped pack only serves the native language it is glossed in', async () => {
    expect(basePack(resolveLanguage('Spanish'), 'en').isShipped).toBe(true)
    expect(basePack(resolveLanguage('Russian'), 'en').isShipped).toBe(true)
    const forRussianSpeakers = basePack(resolveLanguage('Spanish'), 'ru')
    expect(forRussianSpeakers.isShipped).toBe(false)
    expect(forRussianSpeakers.pack.words.length).toBe(0)
    expect(forRussianSpeakers.pack.native).toBe('ru')
  })

  test('a generated pack exports as the source of a shipped one', async () => {
    const { pack } = basePack(resolveLanguage('Ukrainian'), 'en')
    const src = packSource(pack, { words: [{ t: 'так', n: 'yes', reading: 'tak' }, { t: "it's", n: "o'clock", tier: 'tech' }], phrases: [{ t: 'дякую', n: 'thanks', minLevel: 1, reading: 'dyakuyu' }], alphabet: [{ symbol: 'r', sound: 'between r and l' }] })
    expect(src).toContain("export const uk: Pack = {")
    expect(src).toContain("  native: 'en',")
    expect(src).toContain("{ t: 'так', n: 'yes', reading: 'tak' },")
    expect(src).toContain("{ t: 'it\\'s', n: 'o\\'clock', tier: 'tech' },")
    expect(src).toContain("{ t: 'дякую', n: 'thanks', minLevel: 1, reading: 'dyakuyu' },")
    expect(src).toContain("scriptItems: scriptFor('uk').scriptItems,")
    expect(packSource(basePack(resolveLanguage('Dutch'), 'en').pack)).not.toContain('scriptItems')
  })

  test('the cost of generating a pack is estimated in the thousands of tokens', async () => {
    const first = generationEstimate({ count: 150, haveWords: [], wantAlphabet: true, script: 'latin' })
    const later = generationEstimate({ count: 100, haveWords: new Array(300).fill('x'), wantAlphabet: false, script: 'cyrillic' })
    expect(first.output).toBeGreaterThan(3000)
    expect(first.output).toBeLessThan(8000)
    expect(later.input).toBeGreaterThan(first.input)
  })

  test('a generated pack is parsed defensively', async () => {
    const parsed = parseGenerated('Sure! {"words":[{"t":"bonjour","n":"hello"},{"t":"","n":"x"},{"t":"merci","n":"thanks","tier":"tech"},{"t":"bonjour","n":"dup"}],"phrases":[{"t":"Ça va?","n":"How are you?","minLevel":2}],"alphabet":[{"symbol":"r","sound":"throaty"}]}', [])
    expect(parsed?.words.map(w => w.t)).toEqual(['bonjour', 'merci'])
    expect(parsed?.words[1]?.tier).toBe('tech')
    expect(parsed?.phrases[0]?.minLevel).toBe(2)
    expect(parsed?.alphabet.length).toBe(1)
    expect(parseGenerated('no json here', [])).toBeUndefined()
  })
})
