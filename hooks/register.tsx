import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ContextlangBand } from '../types'
import {
  applyReport,
  computeLevel,
  creditAnswer,
  detectForgotten,
  detectUsed,
  findState,
  isProgress,
  knowWord,
  lessonSection,
  makePlan,
  mergePack,
  newProgress,
  readSettings,
  resetWord,
  settingsWarnings,
  statusText,
  turnNote,
  wordsText,
} from './engine'
import type { LevelInfo, Pack, Plan, Progress, Settings, UsageReport } from './engine'
import { generatePrompt, generationEstimate, needsMoreWords, parseGenerated } from './packs/generate'
import type { Generated } from './packs/generate'
import { basePack, isKnownLanguage, resolveLanguage, suggestLanguage } from './packs/index'
import { packSource } from './packs/source'

const PLUGIN = 'contextlang'
const REPORT_TOOL = 'mcp__contextlang__report'
const SESSION_GAP_MS = 30 * 60_000
const band = atom({ plugin: 'contextlang', key: 'band' } as const, null)

type Ctx = {
  settings: Settings
  lang: { code: string; name: string; nativeName: string }
  basePack: Pack
  pack: Pack
  progress: Progress | undefined
  lesson: string
  lessonBucket: number
  isGenerating: boolean
  isShipped: boolean
  /** Whether the typed language is one the plugin knows by name; a typo gets a warning before a pack is generated for it. */
  isKnown: boolean
  suggestion?: string
  progressKey: string
  packKey: string
  /** Where packs were stored before the key carried the native language; read as a fallback for English natives. */
  legacyPackKey: string
}

function isOn(ctx: Ctx): boolean {
  return ctx.settings.enabled && ctx.progress !== undefined && !ctx.progress.isPaused
}

function info(ctx: Ctx): LevelInfo {
  return computeLevel(ctx.progress as Progress, ctx.pack, ctx.settings)
}

async function save($: EngineInterface, ctx: Ctx): Promise<void> {
  if (!ctx.progress) return
  await $.store.set(ctx.progressKey, ctx.progress)
  const i = info(ctx)
  const summary: ContextlangBand = { language: ctx.pack.name, level: i.level, words: i.counts.met, phase: i.phase, isPaused: !isOn(ctx) }
  await update($, band, () => summary)
}

/** The lesson text is rebuilt only when the level crosses a 5-point bucket, so the system prompt stays cacheable within a session. */
function refreshLesson(ctx: Ctx, force = false): void {
  if (!ctx.progress) return
  const i = info(ctx)
  const bucket = Math.floor(i.level / 5)
  if (force || bucket !== ctx.lessonBucket || ctx.lesson === '') {
    ctx.lesson = lessonSection(ctx.pack, ctx.progress, ctx.settings, i)
    ctx.lessonBucket = bucket
  }
}

function asGenerated(stored: unknown): Generated | undefined {
  if (typeof stored !== 'object' || stored === null || !Array.isArray((stored as Generated).words)) return undefined
  const g = stored as Generated
  return { words: g.words, phrases: Array.isArray(g.phrases) ? g.phrases : [], alphabet: Array.isArray(g.alphabet) ? g.alphabet : [] }
}

/** The generated part of this language's pack, if any has been built. */
async function storedPack($: EngineInterface, ctx: Ctx): Promise<Generated | undefined> {
  const stored = asGenerated(await $.store.get(ctx.packKey))
  if (stored || !ctx.legacyPackKey) return stored
  return asGenerated(await $.store.get(ctx.legacyPackKey))
}

async function loadPack($: EngineInterface, ctx: Ctx): Promise<void> {
  const stored = await storedPack($, ctx)
  if (stored) ctx.pack = mergePack(ctx.basePack, stored)
}

const tokens = (n: number): string => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))

/** One model call for the next batch of words; the result lands in the store and the working pack. */
async function extendPack($: EngineInterface, ctx: Ctx, reason: string): Promise<boolean> {
  if (ctx.isGenerating) return false
  ctx.isGenerating = true
  try {
    const prior = (await storedPack($, ctx)) ?? { words: [], phrases: [], alphabet: [] }
    const haveWords = ctx.pack.words.map(w => w.t)
    const request = {
      languageName: ctx.pack.name,
      nativeName: ctx.pack.nativeName,
      native: ctx.settings.native,
      script: ctx.pack.script,
      haveWords,
      havePhrases: ctx.pack.phrases.map(p => p.t),
      wantAlphabet: ctx.pack.alphabet.length === 0,
      count: haveWords.length === 0 ? 150 : 100,
    }
    const prompt = generatePrompt(request)
    const est = generationEstimate(request)
    const sessionModel = await $.session.model()
    const preferred = ctx.settings.packModel.trim() && ctx.settings.packModel.trim() !== 'session' ? ctx.settings.packModel.trim() : sessionModel
    $.ui.status(`ContextLang: building the ${ctx.pack.name} word pack with ${preferred} (about ${tokens(est.input + est.output)} tokens)`)
    if (reason === 'first use') {
      $.ui.toast(
        `ContextLang: no ${ctx.pack.name} pack ships for ${ctx.settings.native} speakers, so one is being generated with ${preferred}: about ${tokens(est.input + est.output)} tokens now, and a similar call each time your level unlocks more words (a few over the coming weeks). The model is the "pack model" row in /config; /contextlang export turns the result into a pack you can contribute.`,
      )
    }
    const ask = (model: string) => $.model.complete({ model, prompt, maxTokens: 12000, effort: 'medium', timeoutMs: 180_000 })
    let reply = await ask(preferred)
    if (!reply.isAnswered && preferred !== sessionModel) reply = await ask(sessionModel)
    if (!reply.isAnswered) {
      $.ui.toast(`ContextLang could not build the ${ctx.pack.name} pack (${reply.reason}); it will try again later.`)
      return false
    }
    const parsed = parseGenerated(reply.text, haveWords)
    if (!parsed) {
      $.ui.toast(`ContextLang got an unreadable ${ctx.pack.name} pack from the model; it will try again later.`)
      return false
    }
    const merged: Generated = {
      words: [...prior.words, ...parsed.words],
      phrases: [...prior.phrases, ...parsed.phrases],
      alphabet: prior.alphabet.length > 0 ? prior.alphabet : parsed.alphabet,
    }
    await $.store.set(ctx.packKey, merged)
    ctx.pack = mergePack(ctx.basePack, merged)
    refreshLesson(ctx, true)
    $.ui.toast(`ContextLang: ${parsed.words.length} ${ctx.pack.name} words ready (${reason}).`)
    return true
  } finally {
    ctx.isGenerating = false
    $.ui.status(undefined)
  }
}

export const register: Register = (on, options) => {
  const settings: Settings = readSettings(options)
  const lang = resolveLanguage(settings.target)
  const nativeCode = resolveLanguage(settings.native).code
  const base = basePack(lang, nativeCode)
  const ctx: Ctx = {
    settings,
    lang,
    basePack: base.pack,
    pack: base.pack,
    progress: undefined,
    lesson: '',
    lessonBucket: -1,
    isGenerating: false,
    isShipped: base.isShipped,
    isKnown: isKnownLanguage(settings.target),
    suggestion: suggestLanguage(settings.target),
    // Progress is per target language; a pack is per (target, native) pair, since its glosses are in the native language.
    progressKey: `progress:${lang.code}`,
    packKey: `pack:${lang.code}:${nativeCode}`,
    legacyPackKey: nativeCode === 'en' ? `pack:${lang.code}` : '',
  }

  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    const stored = await $.store.get(ctx.progressKey)
    ctx.progress = isProgress(stored) ? stored : newProgress(lang.code, now)
    if (now - ctx.progress.lastSessionAt > SESSION_GAP_MS || ctx.progress.sessions === 0) ctx.progress.sessions += 1
    ctx.progress.lastSessionAt = now
    delete ctx.progress.lastPlan
    await loadPack($, ctx)
    await $.command.register({
      name: 'contextlang',
      description: `Your ${ctx.pack.name} progress: status, words, pause, forgot <word>, know <word>, level <n>, reset, export`,
      argumentHint: '[status|words|pause|resume|forgot <word>|know <word>|level <n>|reset|export [path]]',
    })
    await $.tool.register({
      name: 'report',
      description: `ContextLang: report what the person wrote in ${ctx.pack.name} this turn and whether each word or phrase was used correctly, plus any ${ctx.pack.name} words they said they do not know. Call it once, before the final reply, only when their message contained ${ctx.pack.name} or named a word they did not understand.`,
      inputSchema: {
        type: 'object',
        properties: {
          used: {
            type: 'array',
            description: `Each ${ctx.pack.name} word or phrase the person wrote, with a verdict.`,
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'The word or phrase as they wrote it.' },
                correct: { type: 'boolean', description: 'Whether it was correct in form and use.' },
                correction: { type: 'string', description: 'The corrected form, when it was wrong.' },
              },
              required: ['text', 'correct'],
            },
          },
          forgot: {
            type: 'array',
            items: { type: 'string' },
            description: `${ctx.pack.name} words the person said they do not know, understand or remember, or asked the meaning of.`,
          },
        },
      },
      isDeferred: false,
    })
    // A misspelled language should not cost a generated pack: warn first, and build it only on a later session.
    const warnedKey = `warned-language:${lang.code}`
    const warned = ctx.isKnown || Boolean(await $.store.get(warnedKey))
    for (const w of settingsWarnings(settings, { known: ctx.isKnown, suggestion: ctx.suggestion })) {
      if (w.includes('not a language') && warned) continue
      $.ui.toast(w)
    }
    if (!ctx.isKnown && !warned) await $.store.set(warnedKey, true)
    if (ctx.pack.words.length === 0 && settings.enabled && warned) await extendPack($, ctx, 'first use')
    refreshLesson(ctx, true)
    await save($, ctx)
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!isOn(ctx) || ctx.lesson === '') return composed
    return { sections: [...composed.sections, { id: 'contextlang:lesson', text: ctx.lesson, scope: 'session' as const }] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isOn(ctx) || !ctx.progress || e.command || e.isMeta || e.turnId !== undefined) return next(e)
    if (e.origin?.kind === 'plugin' && e.origin.name === PLUGIN) return next(e)
    if (ctx.pack.words.length === 0) return next(e)
    const now = await $.clock.now()
    const forgot = detectForgotten(e.text, ctx.progress)
    for (const t of forgot) {
      const w = ctx.progress.words[t]
      if (w) resetWord(w, ctx.progress.turns + 1, now)
    }
    const used = detectUsed(e.text, ctx.progress)
    const plan: Plan = makePlan(ctx.progress, ctx.pack, settings, now)
    refreshLesson(ctx)
    await save($, ctx)
    const note = turnNote(plan, ctx.pack, settings, used, forgot)
    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined || e.reason !== 'answer' || !ctx.progress || !isOn(ctx)) return next(e)
    const plan = ctx.progress.lastPlan
    if (!plan || plan.turn !== ctx.progress.turns + 1) return next(e)
    const now = await $.clock.now()
    const credit = creditAnswer(ctx.progress, plan, e.answer, settings, now)
    delete ctx.progress.lastPlan
    await save($, ctx)
    if (credit.promoted.length > 0) $.ui.toast(`ContextLang: ${credit.promoted.join(', ')} now appears without translation. Say "I don't know <word>" to bring it back.`)
    if (credit.learned.length > 0) $.ui.toast(`ContextLang: ${credit.learned.join(', ')} ${credit.learned.length === 1 ? 'is' : 'are'} now known.`)
    const met = new Set(Object.keys(ctx.progress.words))
    if (needsMoreWords(ctx.pack, met, info(ctx).level)) $.clock.after(50, () => void extendPack($, ctx, 'more words unlocked'))
    return next(e)
  })

  on('tool.call', { tool: REPORT_TOOL }, async ($, e) => {
    if (!ctx.progress) return { result: 'ContextLang has no progress loaded.' }
    const now = await $.clock.now()
    const used: UsageReport[] = []
    for (const u of Array.isArray(e.used) ? e.used : []) {
      if (typeof u !== 'object' || u === null) continue
      const o = u as Record<string, unknown>
      if (typeof o.text === 'string' && o.text.trim()) used.push({ text: o.text.trim(), correct: o.correct === true })
    }
    const forgot = (Array.isArray(e.forgot) ? e.forgot : []).filter((f): f is string => typeof f === 'string' && f.trim() !== '')
    const outcome = applyReport(ctx.progress, ctx.pack, used, forgot, now)
    await save($, ctx)
    const parts: string[] = []
    if (outcome.credited.length) parts.push(`credited as used correctly: ${outcome.credited.join(', ')}`)
    if (outcome.missed.length) parts.push(`marked for review: ${outcome.missed.join(', ')}`)
    if (outcome.forgot.length) parts.push(`back to side by side: ${outcome.forgot.join(', ')}`)
    const text = parts.length ? `Recorded (${parts.join('; ')}). Now write the final reply.` : 'Nothing matched a tracked word; recorded. Now write the final reply.'
    // A plugin tool's result must be a string (or an array of content blocks); an object is refused by the engine.
    return { result: text }
  })

  on('command.run', { command: 'contextlang' }, async ($, e) => {
    if (!ctx.progress) return { text: 'ContextLang is still loading.' }
    const now = await $.clock.now()
    const [verb = 'status', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ').trim()
    switch (verb.toLowerCase()) {
      case 'status':
      case '':
        return { text: statusText(ctx.pack, ctx.progress, settings, info(ctx), now, { isShipped: ctx.isShipped, known: ctx.isKnown, suggestion: ctx.suggestion }) }
      case 'words':
        return { text: wordsText(ctx.progress) }
      case 'pause':
        ctx.progress.isPaused = true
        await save($, ctx)
        return { text: `ContextLang paused for ${ctx.pack.name}. /contextlang resume brings it back.` }
      case 'resume':
        ctx.progress.isPaused = false
        refreshLesson(ctx, true)
        await save($, ctx)
        return { text: `ContextLang resumed. Level ${info(ctx).level.toFixed(2)}.` }
      case 'forgot': {
        if (!arg) return { text: 'Usage: /contextlang forgot <word>' }
        const w = findState(ctx.progress, ctx.pack, arg)
        if (!w) return { text: `"${arg}" is not in the ${ctx.pack.name} pack. You can still ask Claude what it means.` }
        resetWord(w, ctx.progress.turns + 1, now)
        await save($, ctx)
        return { text: `${w.t} (${w.n}) goes back to side by side.` }
      }
      case 'know': {
        if (!arg) return { text: 'Usage: /contextlang know <word>' }
        const w = findState(ctx.progress, ctx.pack, arg)
        if (!w) return { text: `"${arg}" is not in the ${ctx.pack.name} pack.` }
        knowWord(w, ctx.progress.turns + 1, now)
        await save($, ctx)
        return { text: `${w.t} (${w.n}) is now ${w.stage}.` }
      }
      case 'level': {
        const n = Number(arg)
        if (arg === 'auto' || arg === 'clear') {
          delete ctx.progress.levelOverride
          refreshLesson(ctx, true)
          await save($, ctx)
          return { text: `Level override cleared. Level ${info(ctx).level.toFixed(2)}.` }
        }
        if (!Number.isFinite(n) || n < 0 || n > 100) return { text: 'Usage: /contextlang level <0-100> (or "auto" to clear the override)' }
        ctx.progress.levelOverride = n
        refreshLesson(ctx, true)
        await save($, ctx)
        return { text: `Level pinned at ${n} (phase: ${info(ctx).phase}). /contextlang level auto to let progress set it again.` }
      }
      case 'reset': {
        if (arg !== 'confirm') return { text: `This erases all ${ctx.pack.name} progress (${info(ctx).counts.met} words met, level ${info(ctx).level.toFixed(2)}). Type /contextlang reset confirm to go ahead.` }
        ctx.progress = newProgress(lang.code, now)
        ctx.progress.sessions = 1
        refreshLesson(ctx, true)
        await save($, ctx)
        return { text: `${ctx.pack.name} progress reset.` }
      }
      case 'export': {
        const extra = await storedPack($, ctx)
        if (!extra || extra.words.length === 0) {
          return { text: ctx.isShipped ? `${ctx.pack.name} ships with ContextLang and nothing has been generated on top of it, so there is nothing to export.` : `No ${ctx.pack.name} pack has been generated yet; it is built on first use.` }
        }
        const path = arg || `contextlang-${lang.code}.ts`
        await $.fs.write(path, packSource(ctx.basePack, extra))
        const merged = mergePack(ctx.basePack, extra)
        return {
          text: `Wrote ${merged.words.length} words, ${merged.phrases.length} phrases and ${merged.alphabet.length} sound notes to ${path}. Review the spelling, tiers, readings and notes, then save it as hooks/packs/${lang.code}.ts and add it to SHIPPED in hooks/packs/index.ts to contribute it, so nobody has to generate ${ctx.pack.name} again.`,
        }
      }
      default:
        return { text: `Unknown subcommand "${verb}". Try: status, words, pause, resume, forgot <word>, know <word>, level <n>, reset, export.` }
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!settings.showBand || e.props.hasSurvey) return next(e)
    const value = await read($, band)
    if (!value) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const width = 10
    const filled = Math.round((value.level / 100) * width)
    const bar = '▓'.repeat(filled) + '░'.repeat(width - filled)
    return (
      <Box>
        <Text dimColor>
          ContextLang · {value.language} · {value.level.toFixed(1)} {bar} · {value.words} words · {value.phase}
          {value.isPaused ? ' · paused' : ''}
        </Text>
      </Box>
    )
  })
}
