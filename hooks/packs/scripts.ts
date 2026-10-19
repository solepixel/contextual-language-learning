import type { AlphabetItem, ScriptKind } from '../engine'

// Script primers and letter-and-sound notes for languages whose pack is
// generated on first use. A language with a non-Latin script learns the
// script first (phase "script"): kana and hangul are small enough to learn
// in days, and every textbook sequence puts them before vocabulary so the
// learner never leans on romanisation. Pinyin tones play that role for
// Mandarin, where the characters themselves come with each word.

const hiragana: AlphabetItem[] = [
  ['あ', 'a', 'あさ (asa, morning)'], ['い', 'i', 'いえ (ie, house)'], ['う', 'u', 'うみ (umi, sea)'], ['え', 'e', 'えき (eki, station)'], ['お', 'o', 'おちゃ (ocha, tea)'],
  ['か', 'ka', 'かさ (kasa, umbrella)'], ['き', 'ki', 'き (ki, tree)'], ['く', 'ku', 'くに (kuni, country)'], ['け', 'ke', 'けさ (kesa, this morning)'], ['こ', 'ko', 'こえ (koe, voice)'],
  ['さ', 'sa', 'さけ (sake)'], ['し', 'shi', 'しお (shio, salt)'], ['す', 'su', 'すし (sushi)'], ['せ', 'se', 'せかい (sekai, world)'], ['そ', 'so', 'そら (sora, sky)'],
  ['た', 'ta', 'たこ (tako, octopus)'], ['ち', 'chi', 'ちず (chizu, map)'], ['つ', 'tsu', 'つき (tsuki, moon)'], ['て', 'te', 'て (te, hand)'], ['と', 'to', 'とり (tori, bird)'],
  ['な', 'na', 'なつ (natsu, summer)'], ['に', 'ni', 'にく (niku, meat)'], ['ぬ', 'nu', 'いぬ (inu, dog)'], ['ね', 'ne', 'ねこ (neko, cat)'], ['の', 'no', 'のむ (nomu, to drink)'],
  ['は', 'ha', 'はな (hana, flower)'], ['ひ', 'hi', 'ひと (hito, person)'], ['ふ', 'fu', 'ふゆ (fuyu, winter)'], ['へ', 'he', 'へや (heya, room)'], ['ほ', 'ho', 'ほん (hon, book)'],
  ['ま', 'ma', 'まち (machi, town)'], ['み', 'mi', 'みず (mizu, water)'], ['む', 'mu', 'むし (mushi, insect)'], ['め', 'me', 'め (me, eye)'], ['も', 'mo', 'もり (mori, forest)'],
  ['や', 'ya', 'やま (yama, mountain)'], ['ゆ', 'yu', 'ゆき (yuki, snow)'], ['よ', 'yo', 'よる (yoru, night)'],
  ['ら', 'ra', 'らく (raku, easy)'], ['り', 'ri', 'りんご (ringo, apple)'], ['る', 'ru', 'はる (haru, spring)'], ['れ', 're', 'れい (rei, example)'], ['ろ', 'ro', 'ろく (roku, six)'],
  ['わ', 'wa', 'わたし (watashi, I)'], ['を', 'o (object particle)', 'ほんを よむ (hon o yomu, read a book)'], ['ん', 'n', 'ほん (hon, book)'],
  ['゛ (dakuten)', 'voices a kana: か ka → が ga, さ sa → ざ za, た ta → だ da, は ha → ば ba', 'がっこう (gakkou, school)'],
  ['゜ (handakuten)', 'turns は-row kana into p: は ha → ぱ pa', 'ぱん (pan, bread)'],
  ['small っ', 'doubles the next consonant, a tiny pause', 'きって (kitte, stamp)'],
  ['small ゃ ゅ ょ', 'blend with the kana before them: き + ゃ = きゃ kya', 'きょう (kyou, today)'],
].map(([symbol, sound, example]) => ({ symbol: symbol as string, sound: sound as string, example: example as string }))

const katakana: AlphabetItem[] = [
  ['ア', 'a (katakana, for foreign words)', 'アメリカ (Amerika)'], ['イ', 'i', 'イギリス (Igirisu, Britain)'], ['ウ', 'u', 'ウール (uuru, wool)'], ['エ', 'e', 'エラー (eraa, error)'], ['オ', 'o', 'オレンジ (orenji)'],
  ['カ', 'ka', 'カメラ (kamera)'], ['キ', 'ki', 'キー (kii, key)'], ['ク', 'ku', 'クラス (kurasu, class)'], ['ケ', 'ke', 'ケーキ (keeki, cake)'], ['コ', 'ko', 'コード (koodo, code)'],
  ['サ', 'sa', 'サーバー (saabaa, server)'], ['シ', 'shi', 'システム (shisutemu)'], ['ス', 'su', 'スープ (suupu, soup)'], ['セ', 'se', 'セット (setto, set)'], ['ソ', 'so', 'ソフト (sofuto, software)'],
  ['タ', 'ta', 'タクシー (takushii)'], ['チ', 'chi', 'チーズ (chiizu, cheese)'], ['ツ', 'tsu', 'ツール (tsuuru, tool)'], ['テ', 'te', 'テスト (tesuto, test)'], ['ト', 'to', 'トマト (tomato)'],
  ['ナ', 'na', 'ナイフ (naifu, knife)'], ['ニ', 'ni', 'ニュース (nyuusu, news)'], ['ヌ', 'nu', 'ヌードル (nuudoru, noodle)'], ['ネ', 'ne', 'ネット (netto, net)'], ['ノ', 'no', 'ノート (nooto, notebook)'],
  ['ハ', 'ha', 'ハム (hamu, ham)'], ['ヒ', 'hi', 'ヒント (hinto, hint)'], ['フ', 'fu', 'ファイル (fairu, file)'], ['ヘ', 'he', 'ヘルプ (herupu, help)'], ['ホ', 'ho', 'ホテル (hoteru, hotel)'],
  ['マ', 'ma', 'マウス (mausu, mouse)'], ['ミ', 'mi', 'ミルク (miruku, milk)'], ['ム', 'mu', 'ゲーム (geemu, game)'], ['メ', 'me', 'メール (meeru, email)'], ['モ', 'mo', 'メモ (memo)'],
  ['ヤ', 'ya', 'タイヤ (taiya, tire)'], ['ユ', 'yu', 'ユーザー (yuuzaa, user)'], ['ヨ', 'yo', 'ヨーロッパ (Yooroppa, Europe)'],
  ['ラ', 'ra', 'ラジオ (rajio, radio)'], ['リ', 'ri', 'リスト (risuto, list)'], ['ル', 'ru', 'ルール (ruuru, rule)'], ['レ', 're', 'レベル (reberu, level)'], ['ロ', 'ro', 'ログ (rogu, log)'],
  ['ワ', 'wa', 'ワイン (wain, wine)'], ['ン', 'n', 'パン (pan, bread)'],
  ['ー', 'stretches the vowel before it', 'コーヒー (koohii, coffee)'],
].map(([symbol, sound, example]) => ({ symbol: symbol as string, sound: sound as string, example: example as string }))

const hangul: AlphabetItem[] = [
  ['ㄱ', 'g/k', '가 (ga)'], ['ㄴ', 'n', '나 (na, I)'], ['ㄷ', 'd/t', '다 (da)'], ['ㄹ', 'r/l', '라 (ra)'], ['ㅁ', 'm', '마 (ma)'], ['ㅂ', 'b/p', '바 (ba)'], ['ㅅ', 's', '사 (sa)'],
  ['ㅇ', 'silent at the start of a syllable, "ng" at the end', '아 (a), 강 (gang, river)'], ['ㅈ', 'j', '자 (ja)'], ['ㅊ', 'ch', '차 (cha, tea)'], ['ㅋ', 'k (aspirated)', '카 (ka)'], ['ㅌ', 't (aspirated)', '타 (ta)'], ['ㅍ', 'p (aspirated)', '파 (pa)'], ['ㅎ', 'h', '하 (ha)'],
  ['ㅏ', 'a', '아 (a)'], ['ㅑ', 'ya', '야 (ya)'], ['ㅓ', 'eo (like "uh")', '어 (eo)'], ['ㅕ', 'yeo', '여 (yeo)'], ['ㅗ', 'o', '오 (o)'], ['ㅛ', 'yo', '요 (yo)'], ['ㅜ', 'u', '우 (u)'], ['ㅠ', 'yu', '유 (yu)'], ['ㅡ', 'eu (lips flat, like "uh" with a smile)', '으 (eu)'], ['ㅣ', 'i', '이 (i)'],
  ['ㅐ and ㅔ', 'both "e", nearly the same sound today', '개 (gae, dog), 네 (ne, yes)'],
  ['ㄲ ㄸ ㅃ ㅆ ㅉ', 'tense (doubled) consonants: tighter, no puff of air', '빨리 (ppalli, quickly)'],
  ['syllable blocks', 'letters stack into blocks: consonant + vowel (+ final consonant), read left to right, top to bottom', '한 = ㅎ + ㅏ + ㄴ (han)'],
  ['final consonants (batchim)', 'a consonant under the block closes the syllable', '밥 (bap, rice), 집 (jip, house)'],
].map(([symbol, sound, example]) => ({ symbol: symbol as string, sound: sound as string, example: example as string }))

const pinyin: AlphabetItem[] = [
  ['first tone (ā)', 'high and flat, like holding a note', 'mā 妈 (mother)'],
  ['second tone (á)', 'rising, like asking "what?"', 'má 麻 (hemp)'],
  ['third tone (ǎ)', 'dips down then up', 'mǎ 马 (horse)'],
  ['fourth tone (à)', 'falls sharply, like a firm "no!"', 'mà 骂 (to scold)'],
  ['neutral tone', 'short and light, no contour', 'ma 吗 (question particle)'],
  ['zh ch sh', 'retroflex: tongue curled back, like "j", "ch", "sh" said with the tip of the tongue up', 'zhōng 中, chī 吃, shì 是'],
  ['z c s', 'tongue flat behind the teeth: "dz", "ts", "s"', 'zài 在, cài 菜, sān 三'],
  ['j q x', 'palatal: "j", "ch", "sh" said with a wide smile', 'jiā 家, qù 去, xiè 谢'],
  ['r', 'between English "r" and the "s" in measure', 'rén 人 (person)'],
  ['ü', 'say "ee" with rounded lips (written u after j, q, x, y)', 'nǚ 女 (woman), qù 去 (to go)'],
  ['the -i after zh ch sh r z c s', 'is a buzzed vowel, not "ee"', 'shì 是, zì 字'],
  ['tone change for 3rd + 3rd', 'the first becomes second tone', 'nǐ hǎo 你好 is said ní hǎo'],
].map(([symbol, sound, example]) => ({ symbol: symbol as string, sound: sound as string, example: example as string }))

const cyrillic: AlphabetItem[] = [
  ['А а', 'a', 'да (da, yes)'], ['Б б', 'b', 'брат (brat, brother)'], ['В в', 'v', 'вода (voda, water)'], ['Г г', 'g', 'год (god, year)'], ['Д д', 'd', 'дом (dom, house)'],
  ['Е е', 'ye', 'нет (nyet, no)'], ['Ё ё', 'yo', 'ещё (yeshchyo, still)'], ['Ж ж', 'zh, like the s in measure', 'жить (zhit, to live)'], ['З з', 'z', 'знать (znat, to know)'], ['И и', 'ee', 'или (ili, or)'],
  ['Й й', 'y, as in boy', 'мой (moy, my)'], ['К к', 'k', 'кот (kot, cat)'], ['Л л', 'l', 'лицо (litso, face)'], ['М м', 'm', 'мама (mama)'], ['Н н', 'n', 'нос (nos, nose)'],
  ['О о', 'o when stressed, "a" when not', 'хорошо (kharasho, good)'], ['П п', 'p', 'папа (papa)'], ['Р р', 'rolled r', 'рука (ruka, hand)'], ['С с', 's', 'сын (syn, son)'], ['Т т', 't', 'там (tam, there)'],
  ['У у', 'oo', 'утро (utro, morning)'], ['Ф ф', 'f', 'фото (foto)'], ['Х х', 'kh, a breathy h', 'хлеб (khleb, bread)'], ['Ц ц', 'ts', 'цена (tsena, price)'], ['Ч ч', 'ch', 'час (chas, hour)'],
  ['Ш ш', 'sh', 'школа (shkola, school)'], ['Щ щ', 'shch, a soft long sh', 'щи (shchi, cabbage soup)'], ['Ъ ъ', 'hard sign: a tiny break', 'объект (ob-yekt, object)'], ['Ы ы', 'a deep "i", tongue pulled back', 'мы (my, we)'], ['Ь ь', 'soft sign: softens the consonant before it', 'день (den\', day)'],
  ['Э э', 'e as in met', 'это (eto, this)'], ['Ю ю', 'yu', 'юг (yug, south)'], ['Я я', 'ya', 'я (ya, I)'],
].map(([symbol, sound, example]) => ({ symbol: symbol as string, sound: sound as string, example: example as string }))

const latinNotes: Record<string, AlphabetItem[]> = {
  fr: [
    { symbol: 'final consonants', sound: 'are usually silent', example: 'petit is "puh-tee", vous is "voo"' },
    { symbol: 'r', sound: 'comes from the back of the throat', example: 'merci, bonjour' },
    { symbol: 'u', sound: 'is "ee" said with rounded lips', example: 'tu, salut' },
    { symbol: 'ou', sound: 'is "oo"', example: 'vous, pour' },
    { symbol: 'an, en, on, in', sound: 'are nasal vowels: the n is not pronounced, the vowel goes through the nose', example: 'bon, vin, enfant' },
    { symbol: 'é', sound: 'is "ay"; è and ê are "eh"', example: 'café, très, être' },
    { symbol: 'ç', sound: 'is always "s"', example: 'français, garçon' },
    { symbol: 'h', sound: 'is silent', example: 'heure is "eur"' },
    { symbol: 'liaison', sound: 'a silent final consonant is pronounced when the next word starts with a vowel', example: 'vous avez is "voo-za-vay"' },
    { symbol: 'oi', sound: 'is "wa"', example: 'moi, trois' },
    { symbol: 'gn', sound: 'is "ny"', example: 'montagne, ligne' },
    { symbol: 'eu', sound: 'is like the vowel in "fur" without the r', example: 'deux, peu' },
  ],
  de: [
    { symbol: 'w', sound: 'is "v", and v is "f"', example: 'wir (veer), Vater (fah-ter)' },
    { symbol: 'z', sound: 'is "ts"', example: 'Zeit, zehn' },
    { symbol: 'ch after a, o, u', sound: 'is a throaty "kh"', example: 'Buch, auch' },
    { symbol: 'ch after e, i', sound: 'is a soft hiss, like a whispered "hue"', example: 'ich, nicht' },
    { symbol: 'ä', sound: 'is "eh"', example: 'Mädchen, spät' },
    { symbol: 'ö', sound: 'is "eh" with rounded lips', example: 'schön, können' },
    { symbol: 'ü', sound: 'is "ee" with rounded lips', example: 'über, für' },
    { symbol: 'ß', sound: 'is a sharp "ss"', example: 'Straße, groß' },
    { symbol: 'ei', sound: 'is "eye"; ie is "ee"', example: 'nein (nine), vier (feer)' },
    { symbol: 'eu and äu', sound: 'are "oy"', example: 'neu, Häuser' },
    { symbol: 'sch', sound: 'is "sh"; st and sp at the start are "sht", "shp"', example: 'Schule, Straße, spielen' },
    { symbol: 'j', sound: 'is "y"', example: 'ja, Jahr' },
    { symbol: 'final b, d, g', sound: 'sound like p, t, k', example: 'Tag ends in a "k" sound' },
    { symbol: 'nouns', sound: 'are always capitalised', example: 'das Haus, der Tag' },
  ],
  it: [
    { symbol: 'the vowels', sound: 'are pure and every one is pronounced', example: 'ciao is "chow", mai is "mah-ee"' },
    { symbol: 'c before e or i', sound: 'is "ch"; elsewhere "k"', example: 'cena (cheh-na), casa (kah-za)' },
    { symbol: 'ch', sound: 'is "k"', example: 'che (keh), chiave' },
    { symbol: 'g before e or i', sound: 'is "j"; elsewhere hard "g"', example: 'gente, gatto' },
    { symbol: 'gh', sound: 'is a hard "g"', example: 'ghiaccio, spaghetti' },
    { symbol: 'gli', sound: 'is like "lli" in million', example: 'famiglia, figlio' },
    { symbol: 'gn', sound: 'is "ny"', example: 'gnocchi, bagno' },
    { symbol: 'sc before e or i', sound: 'is "sh"', example: 'pesce, scienza' },
    { symbol: 'double consonants', sound: 'are held longer, and change meaning', example: 'pala (shovel) vs palla (ball)' },
    { symbol: 'r', sound: 'is tapped or rolled', example: 'Roma, arrivare' },
    { symbol: 'h', sound: 'is silent', example: 'ho (oh), hotel' },
    { symbol: 'z', sound: 'is "ts" or "dz"', example: 'pizza, zero' },
    { symbol: 'stress', sound: 'usually falls on the second-to-last syllable; a written accent marks the exception', example: 'ra-GAZ-zo, cit-TÀ' },
  ],
  pt: [
    { symbol: 'ã and õ', sound: 'are nasal vowels, through the nose', example: 'não, manhã, põe' },
    { symbol: 'ão', sound: 'is a nasal "ow"', example: 'coração, pão' },
    { symbol: 'lh', sound: 'is like "lli" in million', example: 'filho, trabalho' },
    { symbol: 'nh', sound: 'is "ny"', example: 'manhã, dinheiro' },
    { symbol: 'r at the start or rr', sound: 'is a throaty "h" in Brazil, rolled in Portugal', example: 'rua, carro' },
    { symbol: 'ç', sound: 'is "s"', example: 'começar, praça' },
    { symbol: 'de and te (Brazil)', sound: 'before an i sound become "jee" and "chee"', example: 'cidade (see-DAH-jee), noite (NOY-chee)' },
    { symbol: 'final o', sound: 'sounds like "oo"', example: 'obrigado, tudo' },
    { symbol: 'x', sound: 'can be "sh", "s", "z" or "ks"', example: 'xícara (sh), próximo (s), exame (z), táxi (ks)' },
    { symbol: 'ou', sound: 'is "oh"', example: 'pouco, sou' },
    { symbol: 'final l (Brazil)', sound: 'sounds like "w"', example: 'Brasil (bra-ZEEW)' },
    { symbol: 'the acute accent', sound: 'opens the vowel and marks stress; the circumflex closes it', example: 'avó (grandmother) vs avô (grandfather)' },
  ],
}

export type ScriptInfo = { script: ScriptKind; alphabet: AlphabetItem[]; scriptItems?: AlphabetItem[] }

export function scriptFor(code: string): ScriptInfo {
  switch (code) {
    case 'ja':
      return { script: 'kana', alphabet: [{ symbol: 'pitch', sound: 'Japanese has no stress accent; syllables are even in length and the pitch steps up or down', example: 'はし can be bridge or chopsticks by pitch' }], scriptItems: [...hiragana, ...katakana] }
    case 'ko':
      return { script: 'hangul', alphabet: [{ symbol: 'politeness endings', sound: '-요 (-yo) on a verb makes it polite; most phrases you will see end this way', example: '감사합니다 (gamsahamnida, thank you)' }], scriptItems: hangul }
    case 'zh':
      return { script: 'hanzi', alphabet: [{ symbol: 'characters', sound: 'each character is one syllable; words are one or two characters, shown with pinyin until you know them', example: '你好 nǐ hǎo (hello)' }], scriptItems: pinyin }
    case 'ru':
    case 'uk':
    case 'bg':
    case 'sr':
      return { script: 'cyrillic', alphabet: [], scriptItems: cyrillic }
    case 'ar':
    case 'he':
    case 'fa':
    case 'hi':
    case 'th':
    case 'el':
    case 'ka':
    case 'hy':
      return { script: 'other', alphabet: [] }
    default:
      return { script: 'latin', alphabet: latinNotes[code] ?? [] }
  }
}
