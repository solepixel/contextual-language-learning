import type { Pack } from '../engine'
import { de } from './de'
import { es } from './es'
import { fr } from './fr'
import { it } from './it'
import { ja } from './ja'
import { ko } from './ko'
import { pt } from './pt'
import { ru } from './ru'
import { zh } from './zh'
import { scriptFor } from './scripts'

const NAMES: Record<string, { code: string; name: string; nativeName: string }> = {
  es: { code: 'es', name: 'Spanish', nativeName: 'español' },
  fr: { code: 'fr', name: 'French', nativeName: 'français' },
  de: { code: 'de', name: 'German', nativeName: 'Deutsch' },
  it: { code: 'it', name: 'Italian', nativeName: 'italiano' },
  pt: { code: 'pt', name: 'Portuguese', nativeName: 'português' },
  nl: { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  sv: { code: 'sv', name: 'Swedish', nativeName: 'svenska' },
  no: { code: 'no', name: 'Norwegian', nativeName: 'norsk' },
  da: { code: 'da', name: 'Danish', nativeName: 'dansk' },
  fi: { code: 'fi', name: 'Finnish', nativeName: 'suomi' },
  pl: { code: 'pl', name: 'Polish', nativeName: 'polski' },
  cs: { code: 'cs', name: 'Czech', nativeName: 'čeština' },
  tr: { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  id: { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  vi: { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  tl: { code: 'tl', name: 'Tagalog', nativeName: 'Tagalog' },
  sw: { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili' },
  ja: { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  ko: { code: 'ko', name: 'Korean', nativeName: '한국어' },
  zh: { code: 'zh', name: 'Mandarin Chinese', nativeName: '中文' },
  ru: { code: 'ru', name: 'Russian', nativeName: 'русский' },
  uk: { code: 'uk', name: 'Ukrainian', nativeName: 'українська' },
  el: { code: 'el', name: 'Greek', nativeName: 'ελληνικά' },
  ar: { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  he: { code: 'he', name: 'Hebrew', nativeName: 'עברית' },
  hi: { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  fa: { code: 'fa', name: 'Persian', nativeName: 'فارسی' },
  th: { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  en: { code: 'en', name: 'English', nativeName: 'English' },
}

const ALIASES: Record<string, string> = {
  spanish: 'es', español: 'es', espanol: 'es', castellano: 'es',
  french: 'fr', français: 'fr', francais: 'fr',
  german: 'de', deutsch: 'de',
  italian: 'it', italiano: 'it',
  portuguese: 'pt', português: 'pt', portugues: 'pt', brazilian: 'pt',
  dutch: 'nl', nederlands: 'nl',
  swedish: 'sv', svenska: 'sv', norwegian: 'no', norsk: 'no', danish: 'da', dansk: 'da', finnish: 'fi', suomi: 'fi',
  polish: 'pl', polski: 'pl', czech: 'cs', turkish: 'tr', türkçe: 'tr', indonesian: 'id', vietnamese: 'vi', tagalog: 'tl', filipino: 'tl', swahili: 'sw',
  japanese: 'ja', 日本語: 'ja', nihongo: 'ja',
  korean: 'ko', 한국어: 'ko', hangul: 'ko',
  chinese: 'zh', mandarin: 'zh', 中文: 'zh', 'mandarin chinese': 'zh', putonghua: 'zh',
  russian: 'ru', русский: 'ru', ukrainian: 'uk',
  greek: 'el', arabic: 'ar', hebrew: 'he', hindi: 'hi', persian: 'fa', farsi: 'fa', thai: 'th',
  english: 'en',
}

export type Language = { code: string; name: string; nativeName: string }

/** Whether the typed language is one this plugin knows by name, alias or code. Unknown ones still work, but get a generated pack. */
export function isKnownLanguage(input: string): boolean {
  const key = input.trim().toLowerCase()
  return Boolean(ALIASES[key] ?? NAMES[key])
}

function editDistance(a: string, b: string): number {
  let row: number[] = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next: number[] = [i]
    for (let j = 1; j <= b.length; j++) {
      next.push(Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)))
    }
    row = next
  }
  return row[b.length] ?? 0
}

/** The known language name closest to a misspelling, when it is close enough to be a typo rather than a language we lack. */
export function suggestLanguage(input: string): string | undefined {
  const key = input.trim().toLowerCase()
  if (key.length < 3 || isKnownLanguage(key)) return undefined
  let best: { name: string; d: number } | undefined
  for (const [alias, code] of Object.entries(ALIASES)) {
    const d = editDistance(key, alias)
    const name = NAMES[code]?.name
    if (name && (!best || d < best.d)) best = { name, d }
  }
  // One slip for a short name, two (a swapped pair counts as two) once the name is six letters or more.
  return best && best.d <= (key.length >= 6 ? 2 : 1) ? best.name : undefined
}

/** The language a person typed in the config, as a code and display names. Unknown names keep the name they typed. */
export function resolveLanguage(input: string): Language {
  const key = input.trim().toLowerCase()
  const code = ALIASES[key] ?? (NAMES[key] ? key : undefined)
  if (code && NAMES[code]) return NAMES[code]
  const name = input.trim().replace(/^./, c => c.toUpperCase())
  return { code: key.replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'xx', name, nativeName: name }
}

/** Curated packs. Each is glossed in one native language, so a learner whose own language differs gets a generated pack instead. */
export const SHIPPED: Pack[] = [es, fr, de, it, pt, ja, ko, zh, ru]

/** The curated pack when one ships for the language glossed in `native`; otherwise an empty pack with its script primer, for the generator to fill. */
export function basePack(lang: Language, native = 'en'): { pack: Pack; isShipped: boolean } {
  const shipped = SHIPPED.find(p => p.code === lang.code && p.native === native)
  if (shipped) return { pack: shipped, isShipped: true }
  const info = scriptFor(lang.code)
  const pack: Pack = { code: lang.code, native, name: lang.name, nativeName: lang.nativeName, script: info.script, words: [], phrases: [], alphabet: info.alphabet }
  if (info.scriptItems) pack.scriptItems = info.scriptItems
  return { pack, isShipped: false }
}
