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
  statusText,
  turnNote,
  wordsText,
} from './engine'
import type { LevelInfo, Pack, Plan, Progress, Settings, UsageReport } from './engine'
import { generatePrompt, needsMoreWords, parseGenerated } from './packs/generate'
import type { Generated } from './packs/generate'
import { basePack, resolveLanguage } from './packs/index'

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
  progressKey: string
  packKey: string
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

async function loadPack($: EngineInterface, ctx: Ctx): Promise<void> {
  const stored = asGenerated(await $.store.get(ctx.packKey))
  if (stored) ctx.pack = mergePack(ctx.basePack, stored)
}

/** One model call for the next batch of words; the result lands in the store and the working pack. */
async function extendPack($: EngineInterface, ctx: Ctx, reason: string): Promise<boolean> {
  if (ctx.isGenerating) return false
  ctx.isGenerating = true
  try {
    $.ui.status(`ContextLang: building the ${ctx.pack.name} word pack`)
    const prior = asGenerated(await $.store.get(ctx.packKey)) ?? { words: [], phrases: [], alphabet: [] }
    const haveWords = ctx.pack.words.map(w => w.t)
    const prompt = generatePrompt({
      languageName: ctx.pack.name,
      nativeName: ctx.pack.nativeName,
      native: ctx.settings.native,
      script: ctx.pack.script,
      haveWords,
      havePhrases: ctx.pack.phrases.map(p => p.t),
      wantAlphabet: ctx.pack.alphabet.length === 0,
      count: haveWords.length === 0 ? 150 : 100,
    })
    const model = await $.session.model()
    const reply = await $.model.complete({ model, prompt, maxTokens: 12000, effort: 'medium', timeoutMs: 180_000 })
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
  const ctx: Ctx = {
    settings,
    lang,
    basePack: basePack(lang).pack,
    pack: basePack(lang).pack,
    progress: undefined,
    lesson: '',
    lessonBucket: -1,
    isGenerating: false,
    progressKey: `progress:${lang.code}`,
    packKey: `pack:${lang.code}`,
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
      description: `Your ${ctx.pack.name} progress: status, words, pause, forgot <word>, know <word>, level <n>, reset`,
      argumentHint: '[status|words|pause|resume|forgot <word>|know <word>|level <n>|reset]',
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
    if (ctx.pack.words.length === 0 && settings.enabled) await extendPack($, ctx, 'first use')
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
        return { text: statusText(ctx.pack, ctx.progress, settings, info(ctx), now) }
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
        if (!w) return { text: `"${arg}" is not in the ${ctx.pack.name} ctx.pack. You can still ask Claude what it means.` }
        resetWord(w, ctx.progress.turns + 1, now)
        await save($, ctx)
        return { text: `${w.t} (${w.n}) goes back to side by side.` }
      }
      case 'know': {
        if (!arg) return { text: 'Usage: /contextlang know <word>' }
        const w = findState(ctx.progress, ctx.pack, arg)
        if (!w) return { text: `"${arg}" is not in the ${ctx.pack.name} ctx.pack.` }
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
        return { text: `Level pinned at ${n} (phase: ${info(ctx).phase}). /contextlang level auto to let ctx.progress set it again.` }
      }
      case 'reset': {
        if (arg !== 'confirm') return { text: `This erases all ${ctx.pack.name} ctx.progress (${info(ctx).counts.met} words met, level ${info(ctx).level.toFixed(2)}). Type /contextlang reset confirm to go ahead.` }
        ctx.progress = newProgress(lang.code, now)
        ctx.progress.sessions = 1
        refreshLesson(ctx, true)
        await save($, ctx)
        return { text: `${ctx.pack.name} ctx.progress reset.` }
      }
      default:
        return { text: `Unknown subcommand "${verb}". Try: status, words, pause, resume, forgot <word>, know <word>, level <n>, reset.` }
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
