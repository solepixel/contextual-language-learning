// ContextLang engine: pure functions over plain data. No engine calls live
// here, which is what makes the scheduling, level math and answer parsing
// testable on their own. hooks/register.ts wires these into Claude Code.

// ---------------------------------------------------------------- packs

export type Tier = 'core' | 'tech' | 'deep'
export type ScriptKind = 'latin' | 'kana' | 'hangul' | 'hanzi' | 'cyrillic' | 'other'

/** One vocabulary entry: target word, native meaning, optional reading (romaji, pinyin) and note. */
export type WordEntry = { t: string; n: string; tier?: Tier; reading?: string; note?: string }
/** A short conversational phrase, unlocked at a level. */
export type PhraseEntry = { t: string; n: string; minLevel: number; reading?: string; note?: string }
/** A letter, digraph or script symbol and how it sounds. */
export type AlphabetItem = { symbol: string; sound: string; example?: string }

export type Pack = {
  code: string
  /** Language code of the glosses, the learner's own language (en for the packs that ship). */
  native: string
  name: string
  nativeName: string
  script: ScriptKind
  words: WordEntry[]
  phrases: PhraseEntry[]
  /** Letters and sounds worth pointing out (Latin alphabets) or the alphabet of a non-Latin one. */
  alphabet: AlphabetItem[]
  /** A syllabary or featural script taught before words are woven in (kana, hangul, pinyin tones). */
  scriptItems?: AlphabetItem[]
}

// ---------------------------------------------------------------- settings

export type Pace = 'gentle' | 'steady' | 'brisk'
export type MarkerStyle = 'brackets' | 'bold' | 'italic' | 'code'

export type Settings = {
  target: string
  native: string
  /** ISO date (YYYY-MM-DD), or '' when unset. Age is derived from it so it never goes stale. */
  birthDate: string
  /** The birth date exactly as typed, so an unreadable one can be pointed out instead of silently dropped. */
  birthDateRaw: string
  pace: Pace
  marker: MarkerStyle
  showBand: boolean
  enabled: boolean
  /** The model that generates a pack for a language without a shipped one; 'session' means whatever model the session runs. */
  packModel: string
}

export const DEFAULT_SETTINGS: Settings = {
  target: 'Spanish',
  native: 'English',
  birthDate: '',
  birthDateRaw: '',
  pace: 'steady',
  marker: 'bold',
  showBand: false,
  enabled: true,
  packModel: 'claude-sonnet-5-5',
}

export function readSettings(options: Readonly<Record<string, unknown>>): Settings {
  const str = (k: string, d: string) => (typeof options[k] === 'string' && (options[k] as string).trim() ? (options[k] as string).trim() : d)
  const num = (k: string, d: number) => (typeof options[k] === 'number' && Number.isFinite(options[k]) ? (options[k] as number) : d)
  const bool = (k: string, d: boolean) => (typeof options[k] === 'boolean' ? (options[k] as boolean) : d)
  const pace = str('pace', 'steady')
  const marker = str('marker_style', 'bold')
  return {
    target: str('target_language', DEFAULT_SETTINGS.target),
    native: str('native_language', DEFAULT_SETTINGS.native),
    birthDate: parseBirthDate(options['birth_date']),
    birthDateRaw: str('birth_date', ''),
    pace: pace === 'gentle' || pace === 'brisk' ? pace : 'steady',
    marker: marker === 'brackets' || marker === 'italic' || marker === 'code' ? marker : 'bold',
    showBand: bool('show_band', false),
    enabled: bool('enabled', true),
    packModel: str('pack_model', DEFAULT_SETTINGS.packModel),
  }
}

/**
 * Normalise a birth date setting to YYYY-MM-DD, or '' when it is missing,
 * unparseable or in the future. Accepts ISO dates and anything Date.parse
 * understands (3/14/1985, March 14 1985).
 */
export function parseBirthDate(v: unknown, now: number = Date.now()): string {
  if (typeof v !== 'string' || !v.trim()) return ''
  const raw = v.trim()
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw)
  const d = iso ? new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))) : new Date(raw)
  if (Number.isNaN(d.getTime()) || d.getTime() > now) return ''
  const y = iso ? d.getUTCFullYear() : d.getFullYear()
  const m = iso ? d.getUTCMonth() : d.getMonth()
  const day = iso ? d.getUTCDate() : d.getDate()
  if (iso && (m !== Number(iso[2]) - 1 || day !== Number(iso[3]))) return ''
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** What a learner should be told about settings the plugin could not use as typed. Empty when everything reads cleanly. */
export function settingsWarnings(s: Settings, lang: { known: boolean; suggestion?: string }): string[] {
  const out: string[] = []
  if (!lang.known) {
    out.push(
      `ContextLang: "${s.target}" is not a language it knows.${lang.suggestion ? ` Did you mean ${lang.suggestion}?` : ''} Check the "Language to learn" row in /config. If it is right, a pack will be generated for it next session.`,
    )
  }
  if (s.birthDateRaw && !s.birthDate) {
    out.push(`ContextLang: birth date "${s.birthDateRaw}" is not readable; use YYYY-MM-DD, such as 1981-09-24. Age stays unset until then.`)
  }
  return out
}

/** Whole years between a YYYY-MM-DD birth date and `now`; 0 when the birth date is unset. */
export function ageAt(birthDate: string, now: number = Date.now()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate)
  if (!m) return 0
  const t = new Date(now)
  let age = t.getUTCFullYear() - Number(m[1])
  const beforeBirthday = t.getUTCMonth() + 1 < Number(m[2]) || (t.getUTCMonth() + 1 === Number(m[2]) && t.getUTCDate() < Number(m[3]))
  if (beforeBirthday) age -= 1
  return Math.max(0, age)
}

/**
 * The numbers the research sets and the settings scale.
 *
 * density: how much target language one reply carries (pace × age, where
 * age is worked out from the birth date each time so it never goes stale).
 * promoteAfter: side-by-side exposures before a word goes bare. Incidental
 * vocabulary studies put form-meaning learning at roughly 6 to 16 encounters
 * (Nation 2001; Webb 2007 found most gains by ~10). Steady uses 14, the top
 * of that range: an encounter here is a glance at a translated word inside a
 * reply about something else, not a study session, and only spaced
 * encounters count, so this is weeks of use rather than a day of it.
 * flipAfter: side-by-side exposures before the order flips, the target word
 * first and its meaning after it; the last part of the way to bare.
 * bareAfter: bare exposures before a word counts as known.
 * scriptInFlight: how many letters may be mid-way through their reps at once;
 * a new letter only arrives when there is room, so the alphabet comes at the
 * pace the reviews are absorbed, not one stranger per reply.
 * Age: Hartshorne et al. (2018) find learning ability high until the late
 * teens; younger children and older adults benefit from lower density and
 * more repetition, so both get more encounters per word and fewer per reply.
 */
export function tuning(s: Settings, now: number = Date.now()) {
  const pace = { gentle: 0.7, steady: 1, brisk: 1.4 }[s.pace]
  const age = ageAt(s.birthDate, now)
  let ageDensity = 1
  let ageReps = 1
  if (age > 0 && age < 10) {
    ageDensity = 0.6
    ageReps = 1.5
  } else if (age > 0 && age < 18) {
    ageDensity = 0.85
    ageReps = 1.15
  } else if (age >= 60) {
    ageDensity = 0.8
    ageReps = 1.25
  }
  const density = pace * ageDensity
  const promoteAfter = Math.max(6, Math.round((14 * ageReps) / Math.sqrt(pace)))
  return {
    density,
    promoteAfter,
    flipAfter: Math.max(4, Math.round(promoteAfter * 0.6)),
    bareAfter: Math.max(5, Math.round(8 * ageReps)),
    itemReps: Math.max(2, Math.round(3 * ageReps)),
    scriptReps: Math.max(3, Math.round(4 * ageReps)),
    scriptInFlight: s.pace === 'brisk' ? 3 : s.pace === 'gentle' ? 1 : 2,
  }
}

// ---------------------------------------------------------------- progress

/** annotated: native word, then the target word in brackets. flipped: the target word, then the native word in brackets. bare: the target word alone. */
export type Stage = 'annotated' | 'flipped' | 'bare' | 'known'

export type WordState = {
  t: string
  n: string
  stage: Stage
  /** Leitner box 0..6; sets the next interval. */
  box: number
  seen: number
  bareSeen: number
  produced: number
  misses: number
  dueTurn: number
  dueAt: number
  introducedTurn: number
}

export type ItemState = { seen: number; dueTurn: number; dueAt: number }

export type Footer = {
  kind: 'alphabet' | 'script' | 'phrase' | 'pronunciation'
  key: string
  text: string
}

export type PlanWord = { t: string; n: string; reading?: string; note?: string }

export type Plan = {
  turn: number
  level: number
  annotate: PlanWord[]
  flip: PlanWord[]
  bare: PlanWord[]
  footer?: Footer
}

export type Progress = {
  version: 1
  language: string
  createdAt: number
  turns: number
  sessions: number
  lastSessionAt: number
  words: Record<string, WordState>
  phrases: Record<string, ItemState>
  alphabet: Record<string, ItemState>
  script: Record<string, ItemState>
  lastPlan?: Plan
  levelOverride?: number
  isPaused?: boolean
}

export function newProgress(language: string, now: number): Progress {
  return {
    version: 1,
    language,
    createdAt: now,
    turns: 0,
    sessions: 0,
    lastSessionAt: now,
    words: {},
    phrases: {},
    alphabet: {},
    script: {},
  }
}

export function isProgress(v: unknown): v is Progress {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Partial<Progress>
  return p.version === 1 && typeof p.language === 'string' && typeof p.words === 'object' && p.words !== null
}

/** The shipped pack plus what the model generated for it later, duplicates dropped. */
export function mergePack(pack: Pack, extra: { words: WordEntry[]; phrases: PhraseEntry[]; alphabet: AlphabetItem[] } | undefined): Pack {
  if (!extra) return pack
  const have = new Set(pack.words.map(w => norm(w.t)))
  const words = extra.words.filter(w => !have.has(norm(w.t)))
  const havePhrases = new Set(pack.phrases.map(w => norm(w.t)))
  const phrases = extra.phrases.filter(w => !havePhrases.has(norm(w.t)))
  const alphabet = pack.alphabet.length > 0 ? pack.alphabet : extra.alphabet
  return { ...pack, words: [...pack.words, ...words], phrases: [...pack.phrases, ...phrases], alphabet }
}

// ---------------------------------------------------------------- spacing

/**
 * Expanding intervals, in turns and in hours, after each successful
 * encounter (Pimsleur 1967's graduated-interval recall; Cepeda et al. 2006
 * on spacing). A word is due when both have elapsed, and an encounter before
 * then counts for nothing, so a heavy day of use cannot burn through a word's
 * schedule in one sitting: the second look comes the same day at the
 * earliest, the third a day later, then every few days, then weekly.
 */
const INTERVAL_TURNS = [1, 2, 3, 5, 8, 13, 21] as const
const INTERVAL_HOURS = [0, 8, 24, 48, 72, 120, 168] as const
const HOUR = 3600_000

function boxed(box: number): number {
  return Math.max(0, Math.min(INTERVAL_TURNS.length - 1, Math.round(box)))
}

function schedule<T extends { box: number; dueTurn: number; dueAt: number }>(x: T, turn: number, now: number, onto: { dueTurn: number; dueAt: number } = x): T {
  const b = boxed(x.box)
  onto.dueTurn = turn + (INTERVAL_TURNS[b] ?? 1)
  onto.dueAt = now + (INTERVAL_HOURS[b] ?? 0) * HOUR
  if (onto !== x) {
    x.dueTurn = onto.dueTurn
    x.dueAt = onto.dueAt
  }
  return x
}

function isDue(x: { dueTurn: number; dueAt: number }, turn: number, now: number): boolean {
  return turn >= x.dueTurn && now >= x.dueAt
}

// ---------------------------------------------------------------- level

export type Phase = 'script' | 'sounds' | 'words' | 'phrases' | 'sentences' | 'immersion' | 'fluent'

export type LevelInfo = {
  level: number
  phase: Phase
  points: number
  wordPoints: number
  phrasePoints: number
  alphabetMastery: number
  scriptMastery: number
  counts: { annotated: number; flipped: number; bare: number; known: number; met: number; inPack: number; phrasesSeen: number; alphabetDone: number; alphabetTotal: number; scriptDone: number; scriptTotal: number }
}

/** How much of a word is learned, 0..1: side-by-side exposures count least, bare more, correct use most (Swain's output hypothesis). */
export function wordMastery(w: WordState): number {
  return Math.min(0.42, w.seen * 0.06) + Math.min(0.4, w.bareSeen * 0.08) + Math.min(0.18, w.produced * 0.09)
}

/** The vocabulary a learner needs for everyday coverage (Nation's ~2000 word families for ~80% of running text). */
const TARGET_WORDS = 2000
const TARGET_PHRASES = 150

export function computeLevel(p: Progress, pack: Pack, s: Settings, now: number = Date.now()): LevelInfo {
  const tune = tuning(s, now)
  const words = Object.values(p.words)
  const wordPoints = words.reduce((sum, w) => sum + wordMastery(w), 0)
  const phrasesSeen = Object.values(p.phrases).filter(x => x.seen > 0).length
  const phrasePoints = Object.values(p.phrases).reduce((sum, x) => sum + Math.min(1, x.seen / tune.itemReps), 0) * 2
  const alphabetTotal = pack.alphabet.length
  const alphabetDone = pack.alphabet.filter(a => (p.alphabet[a.symbol]?.seen ?? 0) >= tune.itemReps).length
  const alphabetMastery = alphabetTotal === 0 ? 0 : pack.alphabet.reduce((sum, a) => sum + Math.min(1, (p.alphabet[a.symbol]?.seen ?? 0) / tune.itemReps), 0) / alphabetTotal
  const scriptItems = pack.scriptItems ?? []
  const scriptTotal = scriptItems.length
  const scriptDone = scriptItems.filter(a => (p.script[a.symbol]?.seen ?? 0) >= tune.scriptReps).length
  const scriptMastery = scriptTotal === 0 ? 1 : scriptItems.reduce((sum, a) => sum + Math.min(1, (p.script[a.symbol]?.seen ?? 0) / tune.scriptReps), 0) / scriptTotal

  // Sounds and script only count once the pack has them; a pack still being generated must not hand out free points.
  const total = TARGET_WORDS + 2 * TARGET_PHRASES + (alphabetTotal > 0 ? 20 : 0) + (scriptTotal > 0 ? 40 : 0)
  const points = wordPoints + phrasePoints + (alphabetTotal > 0 ? alphabetMastery * 20 : 0) + (scriptTotal > 0 ? scriptMastery * 40 : 0)
  let level = Math.min(100, 100 * Math.pow(Math.max(0, points) / total, 0.6))
  if (typeof p.levelOverride === 'number') level = Math.max(0, Math.min(100, p.levelOverride))
  level = Math.round(level * 100) / 100

  let phase: Phase
  if (scriptTotal > 0 && scriptMastery < 0.5) phase = 'script'
  else if (level < 5) phase = 'sounds'
  else if (level < 20) phase = 'words'
  else if (level < 45) phase = 'phrases'
  else if (level < 70) phase = 'sentences'
  else if (level < 90) phase = 'immersion'
  else phase = 'fluent'

  return {
    level,
    phase,
    points,
    wordPoints,
    phrasePoints,
    alphabetMastery,
    scriptMastery,
    counts: {
      annotated: words.filter(w => w.stage === 'annotated').length,
      flipped: words.filter(w => w.stage === 'flipped').length,
      bare: words.filter(w => w.stage === 'bare').length,
      known: words.filter(w => w.stage === 'known').length,
      met: words.length,
      inPack: pack.words.length,
      phrasesSeen,
      alphabetDone,
      alphabetTotal,
      scriptDone,
      scriptTotal,
    },
  }
}

// ---------------------------------------------------------------- planning

export function tierMinLevel(tier: Tier | undefined): number {
  return tier === 'deep' ? 50 : tier === 'tech' ? 25 : 0
}

/** Side-by-side words per reply, flipped ones included: one or two at the start, eight by the immersion phase. */
function annotatedPerReply(level: number, density: number, phase: Phase): number {
  if (phase === 'script') return 1
  return Math.max(1, Math.min(8, Math.round((2 + level / 12) * density)))
}

function barePerReply(level: number, density: number): number {
  return Math.max(2, Math.min(15, Math.round((2 + level / 5) * density)))
}

/** How many words may sit in the side-by-side and flipped stages at once. Words take weeks to go bare, so this is what keeps new ones arriving meanwhile. */
function activeCap(level: number, density: number): number {
  return Math.max(8, Math.min(48, Math.round((16 + level) * density)))
}

function wantsFooter(turn: number, level: number, phase: Phase, pace: Pace): boolean {
  if (phase === 'script' || phase === 'sounds') return true
  const every = level < 10 ? 1 : level < 40 ? 2 : 3
  const stretch = pace === 'brisk' ? 1 : pace === 'gentle' ? 0 : 0
  return turn % (every + stretch) === 0
}

/** Unmet words the level allows, core first, with one word of a higher unlocked tier after every two core words. */
export function freshCandidates(pack: Pack, p: Progress, level: number): WordEntry[] {
  const unmet = pack.words.filter(w => !p.words[w.t] && level >= tierMinLevel(w.tier))
  const core = unmet.filter(w => !w.tier || w.tier === 'core')
  const higher = unmet.filter(w => w.tier === 'tech' || w.tier === 'deep')
  const out: WordEntry[] = []
  let c = 0
  let h = 0
  // The pattern's phase moves with how many words have been met, so taking two at a time still reaches the third slot.
  let k = Object.keys(p.words).length % 3
  while (c < core.length || h < higher.length) {
    const higherTurn = k % 3 === 2
    if (higherTurn && h < higher.length) out.push(higher[h++] as WordEntry)
    else if (c < core.length) out.push(core[c++] as WordEntry)
    else if (h < higher.length) out.push(higher[h++] as WordEntry)
    k += 1
  }
  return out
}

// ---------------------------------------------------------------- readable words in the script phase

const HANGUL_L = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
const HANGUL_V = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ']
const HANGUL_T = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
/** Compound jamo as the basic letters the script lesson teaches. */
const HANGUL_COMPOUND: Record<string, string> = {
  ㄲ: 'ㄱㄱ', ㄸ: 'ㄷㄷ', ㅃ: 'ㅂㅂ', ㅆ: 'ㅅㅅ', ㅉ: 'ㅈㅈ', ㄳ: 'ㄱㅅ', ㄵ: 'ㄴㅈ', ㄶ: 'ㄴㅎ', ㄺ: 'ㄹㄱ', ㄻ: 'ㄹㅁ', ㄼ: 'ㄹㅂ', ㄽ: 'ㄹㅅ', ㄾ: 'ㄹㅌ', ㄿ: 'ㄹㅍ', ㅀ: 'ㄹㅎ', ㅄ: 'ㅂㅅ',
  ㅐ: 'ㅏㅣ', ㅒ: 'ㅑㅣ', ㅔ: 'ㅓㅣ', ㅖ: 'ㅕㅣ', ㅘ: 'ㅗㅏ', ㅙ: 'ㅗㅏㅣ', ㅚ: 'ㅗㅣ', ㅝ: 'ㅜㅓ', ㅞ: 'ㅜㅓㅣ', ㅟ: 'ㅜㅣ', ㅢ: 'ㅡㅣ',
}
const SMALL_KANA: Record<string, string> = { ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', っ: 'つ', ゎ: 'わ', ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ッ: 'ツ', ヮ: 'ワ' }

/** The basic letters a character is made of, in the form the script lesson teaches them: a hangul syllable as its jamo, a voiced or small kana as its base. */
export function scriptLetters(ch: string, script: ScriptKind): string[] {
  if (script === 'hangul') {
    const code = ch.codePointAt(0) ?? 0
    const parts = code >= 0xac00 && code <= 0xd7a3 ? [HANGUL_L[Math.floor((code - 0xac00) / 588)], HANGUL_V[Math.floor(((code - 0xac00) % 588) / 28)], HANGUL_T[(code - 0xac00) % 28]] : [ch]
    return parts.flatMap(j => (j ? [...(HANGUL_COMPOUND[j] ?? j)] : []))
  }
  if (script === 'kana') {
    const base = ch.normalize('NFD').replace(/[\u3099\u309a]/g, '')
    return [SMALL_KANA[base] ?? base]
  }
  return [ch]
}

/** The letters the learner has been shown so far in the script lesson, for scripts whose items are letters; undefined where that is not how the script is taught (tones for Mandarin). */
export function metScriptLetters(p: Progress, pack: Pack): Set<string> | undefined {
  if (!pack.scriptItems || !(pack.script === 'cyrillic' || pack.script === 'kana' || pack.script === 'hangul')) return undefined
  const out = new Set<string>()
  for (const item of pack.scriptItems) {
    if ((p.script[item.symbol]?.seen ?? 0) < 1) continue
    for (const ch of item.symbol.replace(/\s+/g, '')) {
      out.add(ch.toLowerCase())
      out.add(ch.toUpperCase())
    }
  }
  return out
}

/** Whether every letter of the word has been introduced; spaces, digits and punctuation do not count. Kanji are never readable from kana alone. */
export function readableWith(word: string, met: Set<string>, script: ScriptKind): boolean {
  for (const ch of word) {
    if (!/\p{L}/u.test(ch) || ch === 'ー') continue
    for (const letter of scriptLetters(ch, script)) if (!met.has(letter)) return false
  }
  return true
}

/** Build the plan for the turn about to run. Mutates `p` (new words get introduced) and returns the plan. */
export function makePlan(p: Progress, pack: Pack, s: Settings, now: number): Plan {
  const tune = tuning(s, now)
  const info = computeLevel(p, pack, s, now)
  const turn = p.turns + 1
  const level = info.level
  const showReading = pack.script !== 'latin' && info.scriptMastery < 0.85

  const planWord = (w: WordState | WordEntry): PlanWord => {
    const entry = pack.words.find(x => x.t === w.t)
    const out: PlanWord = { t: w.t, n: w.n }
    if (showReading && entry?.reading) out.reading = entry.reading
    if (entry?.note) out.note = entry.note
    return out
  }

  const states = Object.values(p.words)
  // A word that flipped under an earlier, lower threshold goes back to side by side until it earns the flip.
  for (const w of states) if (w.stage === 'flipped' && w.seen < tune.flipAfter) w.stage = 'annotated'
  // Flipped words share the side-by-side slots: same schedule, the other way round on the page.
  const annotated = states.filter(w => w.stage === 'annotated' || w.stage === 'flipped')
  const bareWords = states.filter(w => w.stage === 'bare')

  // 1. Side-by-side words: reviews that are due (most fragile first), and a new word on its own cadence
  //    so reviews never crowd out growth. New words arrive every few turns at first, every turn by level 40.
  const need = annotatedPerReply(level, tune.density, info.phase)
  // In the script phase a word only appears once every letter in it has been taught, so each word is
  // one the learner can actually sound out; a word met before its letters waits until they are.
  const met = info.phase === 'script' ? metScriptLetters(p, pack) : undefined
  const readable = (t: string) => !met || readableWith(t, met, pack.script)
  const due = annotated.filter(w => isDue(w, turn, now) && readable(w.t)).sort((a, b) => a.box - b.box || a.introducedTurn - b.introducedTurn)
  const annotate: WordState[] = due.slice(0, need)
  const newEvery = Math.max(1, Math.round(3 / tune.density / (1 + level / 20)))
  const wantsNew = annotated.length === 0 || turn % newEvery === 0 || annotate.length < need
  if (wantsNew) {
    const room = Math.max(0, activeCap(level, tune.density) - annotated.length)
    const slots = Math.max(1, need + 1 - annotate.length)
    const maxNew = info.phase === 'script' || level < 10 ? 1 : level < 40 ? 2 : 3
    const fresh = freshCandidates(pack, p, level).filter(w => readable(w.t)).slice(0, Math.min(room, slots, maxNew))
    for (const w of fresh) {
      const st: WordState = { t: w.t, n: w.n, stage: 'annotated', box: 0, seen: 0, bareSeen: 0, produced: 0, misses: 0, dueTurn: turn, dueAt: now, introducedTurn: turn }
      p.words[w.t] = st
      annotate.push(st)
    }
  }
  if (annotate.length === 0 && annotated.length > 0) {
    // Nothing due and the pipeline is full: review the one closest to due so no reply goes empty.
    const soonest = [...annotated].sort((a, b) => a.dueTurn - b.dueTurn)[0]
    if (soonest) annotate.push(soonest)
  }

  // 2. Bare words: due ones, most fragile first.
  const bare = bareWords.filter(w => isDue(w, turn, now)).sort((a, b) => a.box - b.box).slice(0, barePerReply(level, tune.density))

  // 3. Footer: script, then alphabet, then a phrase, in that order of need.
  let footer: Footer | undefined
  if (wantsFooter(turn, level, info.phase, s.pace)) footer = pickFooter(p, pack, s, info, turn, now)

  const plan: Plan = {
    turn,
    level,
    annotate: annotate.filter(w => w.stage !== 'flipped').map(planWord),
    flip: annotate.filter(w => w.stage === 'flipped').map(planWord),
    bare: bare.map(planWord),
  }
  if (footer) plan.footer = footer
  p.lastPlan = plan
  return plan
}

function pickFooter(p: Progress, pack: Pack, s: Settings, info: LevelInfo, turn: number, now: number): Footer | undefined {
  const tune = tuning(s, now)
  const scriptItems = pack.scriptItems ?? []
  if (scriptItems.length > 0 && info.scriptMastery < 1) {
    const due = scriptItems.filter(a => {
      const st = p.script[a.symbol]
      return !st || (st.seen < tune.scriptReps && isDue(st, turn, now))
    })
    // A new letter only while few are still being learned (seen, but short of their reps), one at a
    // time, and a footer carries at most two letters: the reviews that are due, least seen first,
    // and a fresh letter when there is room. Letters coming back for review ride along in short form.
    // When nothing is due and there is no room the footer falls through to a sound note or a phrase.
    const inFlight = scriptItems.filter(a => {
      const n = p.script[a.symbol]?.seen ?? 0
      return n > 0 && n < tune.scriptReps
    }).length
    const fresh = inFlight < tune.scriptInFlight ? due.filter(a => !p.script[a.symbol]).slice(0, 1) : []
    const review = due
      .filter(a => p.script[a.symbol])
      .sort((x, y) => (p.script[x.symbol]?.seen ?? 0) - (p.script[y.symbol]?.seen ?? 0))
      .slice(0, (info.phase === 'script' ? 2 : 1) - fresh.length)
    const batch = [...review, ...fresh]
    if (batch.length > 0) {
      const describe = (a: AlphabetItem) => {
        const full = !p.script[a.symbol] && a.example
        return `${styleTarget(a.symbol, s)} is "${a.sound}"${full ? `, as in ${styleExample(a.example!, s)}` : ''}`
      }
      const text = batch.map(describe).join('; ')
      return { kind: 'script', key: batch.map(a => a.symbol).join('|'), text: `${pack.name} script: ${text}.` }
    }
  }
  const alphabetDue = pack.alphabet.filter(a => {
    const st = p.alphabet[a.symbol]
    return !st || (st.seen < tune.itemReps && isDue(st, turn, now))
  })
  const a = alphabetDue[0]
  if (a && (info.phase === 'sounds' || info.phase === 'script' || turn % 2 === 0 || pack.phrases.length === 0)) {
    return { kind: 'alphabet', key: a.symbol, text: alphabetFooter(pack, a, s) }
  }
  const phraseDue = pack.phrases.filter(ph => ph.minLevel <= Math.max(info.level, 1)).filter(ph => {
    const st = p.phrases[ph.t]
    return !st || isDue(st, turn, now)
  })
  const ph = phraseDue.sort((x, y) => (p.phrases[x.t]?.seen ?? 0) - (p.phrases[y.t]?.seen ?? 0) || x.minLevel - y.minLevel)[0]
  if (ph) {
    const reading = ph.reading ? ` (${ph.reading})` : ''
    const note = ph.note ? ` ${ph.note}` : ''
    return { kind: 'phrase', key: ph.t, text: `${styleTarget(ph.t, s)}${reading} means "${ph.n}".${note}` }
  }
  if (a) return { kind: 'alphabet', key: a.symbol, text: alphabetFooter(pack, a, s) }
  return undefined
}

function alphabetFooter(pack: Pack, a: AlphabetItem, s: Settings): string {
  // A one-token symbol (ñ, ll, h) is the letter itself; a phrase like "g before e or i" stays plain.
  const symbol = /\s/.test(a.symbol) ? a.symbol : styleTarget(a.symbol, s)
  return `In ${pack.name}, ${symbol} ${a.sound}${a.example ? `, as in ${styleExample(a.example, s)}` : ''}.`
}

/** Marks a word of the target language the way the marker style asks, without the brackets a side-by-side word gets. */
export function styleTarget(text: string, s: Settings): string {
  const wrap = MARKER_WRAP[s.marker]
  return wrap ? `${wrap}${text}${wrap}` : text
}

/**
 * Styles the target-language words of a free-text example such as
 * 'año (year), mañana (tomorrow)' or 'hola is "oh-la"': each top-level
 * comma-separated chunk's leading words, up to a parenthesis or " is ", are
 * the target language; the gloss or the pronunciation after them stays plain.
 */
export function styleExample(example: string, s: Settings): string {
  if (!MARKER_WRAP[s.marker]) return example
  const chunks: string[] = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let i = 0; i < example.length; i++) {
    const c = example[i]
    if (c === '"') quoted = !quoted
    else if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ',' && depth === 0 && !quoted) {
      chunks.push(example.slice(start, i))
      start = i + 1
    }
  }
  chunks.push(example.slice(start))
  return chunks
    .map(chunk => {
      const lead = chunk.match(/^(\s*)(.*?)(\s+is\s+"|\s+\(|\s*$)/s)
      if (!lead || !lead[2]) return chunk
      const [, pad, word, rest] = lead
      return `${pad}${styleTarget(word, s)}${rest}${chunk.slice(lead[0].length)}`
    })
    .join(',')
}

// ---------------------------------------------------------------- crediting

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_`~\[\]]/g, '')
    .replace(/[¿¡!?.,;:"'()]/g, '')
    .trim()
}

/** Loose match between what the model wrote and a dictionary form: exact, a common inflection, or a shared stem for longer words. */
export function matchesForm(written: string, form: string): boolean {
  const a = norm(written)
  const b = norm(form)
  if (!a || !b) return false
  if (a === b) return true
  if (b.length >= 3 && ['s', 'es', 'a', 'as', 'os', 'o'].some(suffix => a === b + suffix)) return true
  if (b.length >= 4 && ['o', 'a'].includes(b.slice(-1)) && ['o', 'a', 'os', 'as'].some(suffix => a === b.slice(0, -1) + suffix)) return true
  if (b.length >= 5 && a.length >= 5) {
    const stem = Math.min(b.length - 1, Math.max(4, Math.ceil(b.length * 0.7)))
    if (a.startsWith(b.slice(0, stem)) && Math.abs(a.length - b.length) <= 3) return true
  }
  return false
}

export function stripCode(text: string): string {
  return stripFenced(text).replace(/`[^`\n]*`/g, ' ')
}

/** Fenced code blocks only: inline code stays, so a code-styled marker like `[hola]` is still seen. */
export function stripFenced(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ')
}

export function bracketed(text: string): string[] {
  const out: string[] = []
  const re = /\[([^\[\]\n]{1,60})\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const inner = m[1] ?? ''
    // A link's [text](url) and a numbered list marker are not markers of ours.
    if (text[m.index + m[0].length] === '(') continue
    for (const part of inner.split(/[,/]/)) out.push(part)
  }
  return out
}

/**
 * The words just before each bracket, as a flipped word is written: the target word, then its
 * meaning in brackets. Up to three words back, every suffix, so a two-word entry still matches;
 * never past the previous bracket or line, so a side-by-side word is not read as the lead of the next.
 */
export function flippedLeads(text: string): string[] {
  const out: string[] = []
  const re = /\[([^\[\]\n]{1,60})\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (text[m.index + m[0].length] === '(') continue
    let before = text.slice(0, m.index)
    const cut = Math.max(before.lastIndexOf(']'), before.lastIndexOf('\n'))
    if (cut >= 0) before = before.slice(cut + 1)
    const words = before.split(/\s+/).map(norm).filter(Boolean).slice(-3)
    for (let i = 0; i < words.length; i++) out.push(words.slice(i).join(' '))
  }
  return out
}

export function containsBare(text: string, form: string): boolean {
  const f = norm(form)
  if (!f) return false
  const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, 'iu')
  return re.test(text.replace(/[*_~]/g, ''))
}

export const FOOTER_RE = /(^|\n)\s*(?:\*\*|_|\*)?ContextLang(?:\*\*|_|\*)?\s*:/

export type Credit = { annotated: string[]; bare: string[]; footer: boolean; flipped: string[]; promoted: string[]; learned: string[] }

/** Read the final reply against the plan and advance every word it carried. Mutates `p`. */
export function creditAnswer(p: Progress, plan: Plan | undefined, answer: string, s: Settings, now: number): Credit {
  const tune = tuning(s, now)
  const credit: Credit = { annotated: [], bare: [], footer: false, flipped: [], promoted: [], learned: [] }
  const turn = plan?.turn ?? p.turns + 1
  p.turns = Math.max(p.turns, turn)
  const text = stripCode(answer)
  if (!text.trim()) return credit

  const marks = bracketed(stripFenced(answer))
  const leads = flippedLeads(stripFenced(answer))
  const seen = new Set<string>()
  const creditAnnotated = (w: WordState) => {
    if (seen.has(w.t)) return
    seen.add(w.t)
    // Shown before its spacing has elapsed (a reply with nothing due still carries a word), it is a
    // reminder, not a repetition: it counts for nothing, so a busy day cannot run a word through its schedule.
    if (!isDue(w, turn, now)) return
    w.seen += 1
    w.box = boxed(w.box + 1)
    schedule(w, turn, now)
    credit.annotated.push(w.t)
    // Halfway to bare the order flips: the word first, its meaning after it. Nothing else changes.
    if (w.stage === 'annotated' && w.seen >= tune.flipAfter) {
      w.stage = 'flipped'
      credit.flipped.push(w.t)
    }
    if (w.stage === 'flipped' && w.seen >= tune.promoteAfter && w.box >= 4) {
      w.stage = 'bare'
      w.box = 2
      schedule(w, turn, now)
      credit.promoted.push(w.t)
    }
  }
  // Any active word the reply marked counts, planned or not, in either order; bare and known ones marked again are fine too.
  const plannedWords = [...(plan?.annotate ?? []), ...(plan?.flip ?? [])]
  const planned = plannedWords.map(x => p.words[x.t]).filter((w): w is WordState => w !== undefined)
  const others = Object.values(p.words).filter(w => !planned.includes(w))
  for (const w of [...planned, ...others]) {
    const entryReading = plannedWords.find(x => x.t === w.t)?.reading
    const isForm = (m: string) => matchesForm(m, w.t) || (entryReading !== undefined && matchesForm(m, entryReading))
    if (marks.some(isForm) || leads.some(isForm)) creditAnnotated(w)
  }
  for (const pw of plan?.bare ?? []) {
    const w = p.words[pw.t]
    if (!w || seen.has(w.t)) continue
    if (containsBare(text, w.t)) {
      seen.add(w.t)
      w.bareSeen += 1
      w.box = boxed(w.box + 1)
      // Bare words are cheap to show, so their gaps stop growing at 8 turns / three days.
      schedule({ ...w, box: Math.min(w.box, 4) }, turn, now, w)
      credit.bare.push(w.t)
      if (w.stage === 'bare' && w.bareSeen >= tune.bareAfter) {
        w.stage = 'known'
        credit.learned.push(w.t)
      }
    }
  }
  if (plan?.footer && FOOTER_RE.test(answer)) {
    credit.footer = true
    const f = plan.footer
    const bump = (table: Record<string, ItemState>, key: string, box: number) => {
      const st = table[key] ?? { seen: 0, dueTurn: turn, dueAt: now }
      st.seen += 1
      const timed = schedule({ box, dueTurn: st.dueTurn, dueAt: st.dueAt }, turn, now)
      st.dueTurn = timed.dueTurn
      st.dueAt = timed.dueAt
      table[key] = st
    }
    if (f.kind === 'script') for (const key of f.key.split('|')) bump(p.script, key, Math.min(6, (p.script[key]?.seen ?? 0) + 1))
    if (f.kind === 'alphabet') bump(p.alphabet, f.key, Math.min(6, (p.alphabet[f.key]?.seen ?? 0) + 2))
    if (f.kind === 'phrase') bump(p.phrases, f.key, Math.min(6, (p.phrases[f.key]?.seen ?? 0) + 2))
  }
  return credit
}

// ---------------------------------------------------------------- the learner's own use

export type UsageReport = { text: string; correct: boolean }

export type UsageOutcome = { credited: string[]; missed: string[]; forgot: string[] }

/** The model's report of what the learner wrote in the target language, and what they said they did not know. Mutates `p`. */
export function applyReport(p: Progress, pack: Pack, used: UsageReport[], forgot: string[], now: number): UsageOutcome {
  const out: UsageOutcome = { credited: [], missed: [], forgot: [] }
  const turn = p.turns + 1
  const findWord = (text: string): WordState | undefined => {
    const direct = Object.values(p.words).find(w => matchesForm(text, w.t))
    if (direct) return direct
    const entry = pack.words.find(w => matchesForm(text, w.t) || norm(w.n) === norm(text))
    if (!entry) return undefined
    const st: WordState = { t: entry.t, n: entry.n, stage: 'annotated', box: 0, seen: 0, bareSeen: 0, produced: 0, misses: 0, dueTurn: turn, dueAt: now, introducedTurn: turn }
    p.words[entry.t] = st
    return st
  }
  for (const u of used) {
    const words = u.text.split(/[\s,.;:!?¿¡"']+/).filter(Boolean)
    const targets = new Set<WordState>()
    const whole = findWord(u.text)
    if (whole) targets.add(whole)
    for (const token of words) {
      const w = Object.values(p.words).find(x => matchesForm(token, x.t))
      if (w) targets.add(w)
    }
    for (const w of targets) {
      if (u.correct) {
        w.produced += 1
        w.box = boxed(w.box + 1)
        schedule(w, turn, now)
        if (w.stage === 'bare' && w.produced >= 3) w.stage = 'known'
        out.credited.push(w.t)
      } else {
        w.misses += 1
        w.box = boxed(w.box - 1)
        if (w.stage === 'known') w.stage = 'bare'
        w.dueTurn = turn
        w.dueAt = now
        out.missed.push(w.t)
      }
    }
    const phrase = pack.phrases.find(ph => matchesForm(u.text, ph.t))
    if (phrase && u.correct) {
      const st = p.phrases[phrase.t] ?? { seen: 0, dueTurn: turn, dueAt: now }
      st.seen += 1
      p.phrases[phrase.t] = st
    }
  }
  for (const f of forgot) {
    const w = findWord(f)
    if (!w) continue
    resetWord(w, turn, now)
    out.forgot.push(w.t)
  }
  return out
}

/** Back to side-by-side, half the credit kept so it is not treated as brand new. */
export function resetWord(w: WordState, turn: number, now: number): void {
  w.stage = 'annotated'
  w.box = 0
  w.seen = Math.floor(w.seen / 2)
  w.bareSeen = 0
  w.misses += 1
  w.dueTurn = turn
  w.dueAt = now
}

/** The learner says they know it: straight to bare. */
export function knowWord(w: WordState, turn: number, now: number): void {
  if (w.stage === 'annotated' || w.stage === 'flipped') {
    w.stage = 'bare'
    w.seen = Math.max(w.seen, 6)
  } else if (w.stage === 'bare') {
    w.stage = 'known'
  }
  w.box = Math.max(w.box, 3)
  schedule(w, turn, now)
}

export function findState(p: Progress, pack: Pack, text: string): WordState | undefined {
  const direct = Object.values(p.words).find(w => matchesForm(text, w.t) || norm(w.n) === norm(text))
  if (direct) return direct
  const entry = pack.words.find(w => matchesForm(text, w.t) || norm(w.n) === norm(text))
  if (!entry) return undefined
  const st: WordState = { t: entry.t, n: entry.n, stage: 'annotated', box: 0, seen: 0, bareSeen: 0, produced: 0, misses: 0, dueTurn: p.turns + 1, dueAt: 0, introducedTurn: p.turns + 1 }
  p.words[entry.t] = st
  return st
}

// ---------------------------------------------------------------- words in the learner's prompt

const FORGOT_RE = /\b(?:don'?t|do not|didn'?t|never|not sure (?:what|if))\s+(?:know|understand|remember|recall|get)\b|what (?:does|is|do|are)\s+.{1,60}\s+mean|no (?:entiendo|sé|lo sé)|\bforgot\b|\bforgotten\b|\bmeaning of\b/i

/** Words the learner says they have lost, read straight off the prompt as a fallback for when the model does not report them. */
export function detectForgotten(prompt: string, p: Progress): string[] {
  if (!FORGOT_RE.test(prompt)) return []
  const quoted = [...prompt.matchAll(/["'“‘\[]([^"'”’\]]{1,40})["'”’\]]/g)].map(m => m[1] ?? '')
  const candidates = quoted.length > 0 ? quoted : prompt.split(/[\s,.;:!?¿¡"']+/)
  const out: string[] = []
  for (const c of candidates) {
    const w = Object.values(p.words).find(x => x.stage !== 'annotated' && matchesForm(c, x.t))
    if (w && !out.includes(w.t)) out.push(w.t)
  }
  return out
}

/** Target-language words the learner used in their prompt, so the model is told to react. */
export function detectUsed(prompt: string, p: Progress): string[] {
  const text = stripCode(prompt)
  const out: string[] = []
  for (const w of Object.values(p.words)) {
    if (norm(w.t) === norm(w.n)) continue // cognates spelled the same prove nothing
    if (containsBare(text, w.t)) out.push(w.t)
  }
  return out
}

// ---------------------------------------------------------------- prompt text

export function formatAnnotated(native: string, target: string, s: Settings, reading?: string): string {
  const inner = reading ? `${target}, ${reading}` : target
  const wrap = MARKER_WRAP[s.marker]
  return `${native} ${wrap}[${inner}]${wrap}`
}

/** The flipped form: the target word in italics, then its meaning in the bracket, with the reading after the meaning while the script is new. */
export function formatFlipped(target: string, native: string, s: Settings, reading?: string): string {
  const inner = reading ? `${native}, ${reading}` : native
  const wrap = MARKER_WRAP[s.marker]
  return `*${target}* ${wrap}[${inner}]${wrap}`
}

const MARKER_WRAP: Record<MarkerStyle, string> = { brackets: '', bold: '**', italic: '*', code: '`' }

/** How the lesson describes the marker, so the model writes it the way the setting asks. */
export function markerRule(s: Settings): string {
  switch (s.marker) {
    case 'bold':
      return 'in square brackets, the whole bracket in bold'
    case 'italic':
      return 'in square brackets, the whole bracket in italics'
    case 'code':
      return 'in square brackets wrapped in backticks as inline code (this is the one place inline code is allowed)'
    default:
      return 'in square brackets'
  }
}

function phaseGuidance(phase: Phase, pack: Pack, native: string): string {
  switch (phase) {
    case 'script':
      return `The learner is still learning the ${pack.name} script. Keep the reply in ${native}. Weave in at most the one word the turn plan names, written in ${pack.name} script with its reading, and give the footer every turn: it is the script lesson.`
    case 'sounds':
      return `Stay in ${native}. Weave in only the one or two words the turn plan names, side by side with their ${native} meaning. The footer teaches a sound each turn.`
    case 'words':
      return `Stay in ${native} prose. Weave in the words the turn plan names, side by side, and use bare words where their meaning comes up. Greetings and sign-offs may be in ${pack.name} when the words are bare.`
    case 'phrases':
      return `${native} prose, with ${pack.name} entering as short phrases: besides the planned words, write one short sentence or clause per reply in ${pack.name} followed by its ${native} meaning in parentheses, built from words the learner has met where possible.`
    case 'sentences':
      return `About a quarter to a half of the plain sentences in ${pack.name}. A sentence made only of bare or known words needs no translation; one that uses a new word gets the ${native} meaning in parentheses after it. Headings, code, commands and anything to copy stay as they are.`
    case 'immersion':
      return `Most of the prose in ${pack.name}; about three sentences in four. Fall back to ${native} only for precise technical explanation, and keep code, commands, paths and identifiers untouched. A new word still gets its meaning side by side the first times.`
    case 'fluent':
      return `Write the whole reply in ${pack.name}, apart from code, commands, paths, identifiers and quoted error text. Annotate only words the turn plan marks as new.`
  }
}

/** The stable part of the lesson, composed once per session so the prompt cache holds. */
export function lessonSection(pack: Pack, p: Progress, s: Settings, info: LevelInfo): string {
  const native = s.native
  const sampleTarget = pack.code === 'es' ? 'preguntas' : pack.words[0]?.t ?? 'word'
  const sampleReading = pack.script !== 'latin' ? pack.words[0]?.reading : undefined
  const sample = formatAnnotated('questions', sampleTarget, s, sampleReading)
  const flippedSample = formatFlipped(sampleTarget, 'questions', s, sampleReading)
  const free = Object.values(p.words)
    .filter(w => w.stage === 'bare' || w.stage === 'known')
    .sort((a, b) => a.introducedTurn - b.introducedTurn)
  const freeList = free.slice(0, 300).map(w => w.t).join(', ')
  const freeMore = free.length > 300 ? ` and ${free.length - 300} more the learner has met` : ''
  const lines = [
    `# ContextLang`,
    `The person you are talking to is learning ${pack.name} (${pack.nativeName}) from ${native}, gradually, through these conversations. There is no lesson mode: you weave a little ${pack.name} into your replies and the plugin tracks what they have seen. Their level is ${info.level.toFixed(1)} of 100 (phase: ${info.phase}).`,
    ``,
    `## Where`,
    `Only in the final reply to the person, the one that ends your turn, and only in the words you say to them. Never in progress notes while you work, tool inputs, commit messages, code, commands, file paths, identifiers, URLs, quoted error text, or anything they might copy and run. Never inside code blocks or inline code.`,
    `Never in anything written for the person to send or publish as their own: a drafted email, Slack or chat message, GitHub comment, pull request or issue text, commit message, ticket, documentation, README, or any text they will paste elsewhere. Those read as the person's words, not yours, and a ${pack.name} word in them would go out under their name. Keep such a draft free of ${pack.name} and of the footer; put the footer after the draft, on its own line, as part of your reply around it.`,
    ``,
    `## How`,
    `- A side-by-side word is written as the ${native} word followed by the ${pack.name} word ${markerRule(s)}: "${sample}". Inflect the ${pack.name} word to fit (plural, gender, verb form). Put it where the ${native} word naturally occurs; if a planned word would not fit the reply, skip it rather than force it.`,
    `- A flipped word is one the person has met side by side a few times, so it is written the other way round: the ${pack.name} word in italics, then the ${native} word ${markerRule(s)}: "${flippedSample}". It goes where the ${native} word would go, inflected the same way.`,
    `- A bare word is written in ${pack.name} alone, in italics, in place of its ${native} word: it is one the person has seen enough times. Use bare words wherever their meaning comes up.`,
    `- ${phaseGuidance(info.phase, pack, native)}`,
    `- When the turn plan gives a footer, end the reply with one line that starts with "ContextLang:" followed by the footer text, verbatim. No footer line otherwise.`,
    `- A hidden note headed "[ContextLang turn plan]" follows the person's message with the words and footer for that reply. Follow it. When no note arrives, add nothing.`,
    ``,
    `## When they write ${pack.name}`,
    `The person is encouraged to mix ${pack.name} into their messages. Whenever their message contains any ${pack.name}, or they say they do not know, understand or remember a ${pack.name} word, or ask what one means, call the tool mcp__contextlang__report exactly once before writing the final reply: list each ${pack.name} word or phrase they used with whether it was correct, and list the words they said they did not know under "forgot". Then, in the final reply, acknowledge it in one short sentence: praise what was right, or give the corrected form with a word on why. Explain any word they asked about in plain ${native}. They may also ask for a translation of anything at any time; answer briefly.`,
    ``,
    `## Words the person already knows`,
    free.length === 0 ? `None yet.` : `Use any of these bare, whenever their meaning comes up: ${freeList}${freeMore}.`,
  ]
  return lines.join('\n')
}

/** The per-turn note, attached beside the prompt so the system prompt stays cached. */
export function turnNote(plan: Plan, pack: Pack, s: Settings, used: string[], forgot: string[]): string {
  const lines = [`[ContextLang turn plan] Turn ${plan.turn}, level ${plan.level.toFixed(1)}. Applies to the final reply only.`]
  if (plan.annotate.length > 0) {
    const items = plan.annotate.map(w => {
      const note = w.note ? ` (${w.note})` : ''
      return `${w.n} → ${formatAnnotated(w.n, w.t, s, w.reading).slice(w.n.length + 1)}${note}`
    })
    lines.push(`Side by side (${s.native} word, then the ${pack.name} word ${markerRule(s)}), where the meaning naturally occurs: ${items.join('; ')}.`)
  }
  if (plan.flip.length > 0) {
    const items = plan.flip.map(w => {
      const note = w.note ? ` (${w.note})` : ''
      return `${w.n} → ${formatFlipped(w.t, w.n, s, w.reading)}${note}`
    })
    lines.push(`Flipped (the ${pack.name} word in italics, then the ${s.native} word ${markerRule(s)}), where the meaning naturally occurs: ${items.join('; ')}.`)
  }
  if (plan.bare.length > 0) lines.push(`Bare, in italics, no translation: ${plan.bare.map(w => `${w.t} (${w.n})`).join(', ')}.`)
  if (plan.footer) lines.push(`Footer, as the last line of the reply, verbatim: ContextLang: ${plan.footer.text}`)
  if (used.length > 0) lines.push(`The person's message contains ${pack.name} (${used.join(', ')}): judge it, call mcp__contextlang__report, and react in one sentence.`)
  if (forgot.length > 0) lines.push(`The person said they do not know: ${forgot.join(', ')}. The plugin has reset them; explain each briefly.`)
  return lines.join('\n')
}

// ---------------------------------------------------------------- toasts

/** How long a toast stays, in milliseconds: about 50 ms a character, held between 8 and 20 seconds. */
export function toastTimeout(text: string): number {
  return Math.min(20_000, Math.max(8000, text.length * 50))
}

// ---------------------------------------------------------------- status

export function progressBar(level: number, width = 20): string {
  const filled = Math.round((Math.max(0, Math.min(100, level)) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export type StatusSource = { isShipped: boolean; known: boolean; suggestion?: string }

export function statusText(pack: Pack, p: Progress, s: Settings, info: LevelInfo, now: number, source?: StatusSource): string {
  const c = info.counts
  const turn = p.turns + 1
  const age = ageAt(s.birthDate, now)
  const birth = s.birthDate ? `${s.birthDate} (age ${age})` : s.birthDateRaw ? `"${s.birthDateRaw}" is not readable, use YYYY-MM-DD` : 'not set'
  const packSource = source ? (source.isShipped ? 'shipped pack' : source.known ? 'generated pack' : `not a known language${source.suggestion ? `, did you mean ${source.suggestion}?` : ''}`) : ''
  const due = Object.values(p.words)
    .filter(w => (w.stage === 'annotated' || w.stage === 'flipped') && isDue(w, turn, now))
    .sort((a, b) => a.box - b.box)
    .slice(0, 8)
    .map(w => `${w.t} (${w.n})`)
  const lines = [
    `**ContextLang** · ${pack.name} (${pack.nativeName}) from ${s.native}${p.isPaused || !s.enabled ? ' · paused' : ''}`,
    `Level **${info.level.toFixed(2)}** / 100 · phase: ${info.phase} · pace: ${s.pace}${age > 0 ? ` · age ${age}` : ''}`,
    `\`${progressBar(info.level)}\``,
    ``,
    `Words: ${c.annotated} side by side · ${c.flipped} flipped · ${c.bare} bare · ${c.known} known · ${c.met} met of ${c.inPack} in the pack`,
    `Phrases seen: ${c.phrasesSeen} · Sounds: ${c.alphabetDone}/${c.alphabetTotal}${c.scriptTotal > 0 ? ` · Script: ${c.scriptDone}/${c.scriptTotal}` : ''}`,
    `Turns: ${p.turns} · Sessions: ${p.sessions} · Started: ${new Date(p.createdAt).toISOString().slice(0, 10)}`,
    ``,
    `Settings as read: learn ${s.target} → ${pack.name} (${pack.code}${packSource ? `, ${packSource}` : ''}) · from ${s.native} · birth date ${birth} · pace ${s.pace} · marker ${s.marker} · pack model ${s.packModel}`,
  ]
  if (due.length > 0) lines.push(``, `Due now: ${due.join(', ')}`)
  lines.push(``, `/contextlang words · forgot <word> · know <word> · pause · resume · level <n> · reset`)
  return lines.join('\n')
}

export function wordsText(p: Progress): string {
  const all = Object.values(p.words).sort((a, b) => a.introducedTurn - b.introducedTurn)
  if (all.length === 0) return 'No words met yet. Send a prompt and the first one arrives in the reply.'
  const group = (stage: Stage) => all.filter(w => w.stage === stage).map(w => `${w.t} (${w.n}, ×${w.seen + w.bareSeen}${w.produced ? `, used ${w.produced}` : ''})`)
  const lines: string[] = []
  const a = group('annotated')
  const f = group('flipped')
  const b = group('bare')
  const k = group('known')
  if (a.length) lines.push(`**Side by side (${a.length})**: ${a.join(', ')}`)
  if (f.length) lines.push(`**Flipped, meaning after the word (${f.length})**: ${f.join(', ')}`)
  if (b.length) lines.push(`**Bare (${b.length})**: ${b.join(', ')}`)
  if (k.length) lines.push(`**Known (${k.length})**: ${k.join(', ')}`)
  return lines.join('\n\n')
}
