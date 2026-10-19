import type { AlphabetItem, Pack, PhraseEntry, Tier, WordEntry } from '../engine'
import { norm } from '../engine'

// For a language with no curated pack, or when the learner has met every
// word the pack holds, the next batch of vocabulary comes from one model
// call: frequency-ordered, with native meanings, readings for non-Latin
// scripts, and a tier so technical words wait for the right level.

export type Generated = { words: WordEntry[]; phrases: PhraseEntry[]; alphabet: AlphabetItem[] }

export type GenerateRequest = {
  languageName: string
  nativeName: string
  native: string
  script: string
  haveWords: string[]
  havePhrases: string[]
  wantAlphabet: boolean
  count: number
}

export function generatePrompt(r: GenerateRequest): string {
  const exclude = r.haveWords.length > 0 ? `\nAlready covered, do not repeat (${r.haveWords.length}): ${r.haveWords.slice(-600).join(', ')}` : ''
  const excludePhrases = r.havePhrases.length > 0 ? `\nPhrases already covered: ${r.havePhrases.slice(-80).join(' | ')}` : ''
  const reading = r.script !== 'latin' ? ` Every word and phrase also carries "reading": its romanisation (romaji for Japanese, revised romanisation for Korean, pinyin with tone marks for Mandarin, standard transliteration otherwise).` : ''
  const alphabet = r.wantAlphabet
    ? `\n"alphabet": 10 to 16 entries, each { "symbol", "sound", "example" }, covering the letters, digraphs and sounds of ${r.languageName} a speaker of ${r.native} most needs pointed out (silent letters, sounds ${r.native} lacks, stress rules), in plain words a learner can act on.`
    : `\n"alphabet": [].`
  return [
    `You are compiling a vocabulary pack for ContextLang, which teaches ${r.languageName} (${r.nativeName}) to a speaker of ${r.native} by weaving words into everyday conversation with a coding assistant.`,
    `Return ONLY a JSON object, no prose, no code fence, with these fields:`,
    `"words": exactly ${r.count} entries, ordered from most to least frequent in everyday speech and in talk about work, plans, questions, files and changes. Each is { "t": the ${r.languageName} word in its dictionary form, "n": its ${r.native} meaning in one to three words, "tier": "core" | "tech" | "deep", "note": optional, a short note on gender, irregular forms or a common collocation }. "core" is everyday language (about 85% of the list); "tech" is software vocabulary a programmer uses daily (file, function, server, bug); "deep" is specialist computing vocabulary (compiler, concurrency, migration).${reading}${exclude}`,
    `"phrases": 20 short conversational sentences a helpful assistant or a learner would actually say (greetings, "let me see", "it works", "I have a question", "I don't understand"), each { "t", "n", "minLevel": 0 to 40, the lowest first }${r.script !== 'latin' ? ', with "reading"' : ''}.${excludePhrases}`,
    alphabet,
    `Spelling must be correct and natural; prefer the most widely understood variety of ${r.languageName}. No duplicates.`,
  ].join('\n')
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** Read what the model answered, dropping anything malformed rather than failing the whole batch. */
export function parseGenerated(text: string, haveWords: string[]): Generated | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null) return undefined
  const obj = raw as Record<string, unknown>
  const seen = new Set(haveWords.map(norm))
  const words: WordEntry[] = []
  for (const w of Array.isArray(obj.words) ? obj.words : []) {
    if (typeof w !== 'object' || w === null) continue
    const o = w as Record<string, unknown>
    const t = str(o.t)
    const n = str(o.n)
    if (!t || !n || seen.has(norm(t))) continue
    seen.add(norm(t))
    const entry: WordEntry = { t, n }
    const tier = str(o.tier)
    if (tier === 'tech' || tier === 'deep') entry.tier = tier as Tier
    const reading = str(o.reading)
    if (reading) entry.reading = reading
    const note = str(o.note)
    if (note) entry.note = note.slice(0, 120)
    words.push(entry)
  }
  const phrases: PhraseEntry[] = []
  for (const ph of Array.isArray(obj.phrases) ? obj.phrases : []) {
    if (typeof ph !== 'object' || ph === null) continue
    const o = ph as Record<string, unknown>
    const t = str(o.t)
    const n = str(o.n)
    if (!t || !n) continue
    const minLevel = typeof o.minLevel === 'number' && Number.isFinite(o.minLevel) ? Math.max(0, Math.min(90, o.minLevel)) : 0
    const entry: PhraseEntry = { t, n, minLevel }
    const reading = str(o.reading)
    if (reading) entry.reading = reading
    const note = str(o.note)
    if (note) entry.note = note.slice(0, 120)
    phrases.push(entry)
  }
  const alphabet: AlphabetItem[] = []
  for (const a of Array.isArray(obj.alphabet) ? obj.alphabet : []) {
    if (typeof a !== 'object' || a === null) continue
    const o = a as Record<string, unknown>
    const symbol = str(o.symbol)
    const sound = str(o.sound)
    if (!symbol || !sound) continue
    const item: AlphabetItem = { symbol, sound }
    const example = str(o.example)
    if (example) item.example = example
    alphabet.push(item)
  }
  if (words.length === 0) return undefined
  return { words, phrases, alphabet }
}

/** Whether the pack has run dry for this level: nothing left to introduce that the level allows. */
export function needsMoreWords(pack: Pack, metWords: Set<string>, level: number): boolean {
  const minLevelFor = (tier: Tier | undefined) => (tier === 'deep' ? 50 : tier === 'tech' ? 25 : 0)
  const left = pack.words.filter(w => !metWords.has(w.t) && level >= minLevelFor(w.tier)).length
  return left < 10
}
