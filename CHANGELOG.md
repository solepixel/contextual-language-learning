# Changelog

## 0.2.6 (2026-10-21)
- Toasts stay long enough to read. The engine default is four seconds; ContextLang now holds a toast for about fifty milliseconds a character, at least eight seconds and at most twenty, so the flip and bare-word notices sit around ten seconds. Hovering still holds one and a click still dismisses it.

## 0.2.5 (2026-10-20)
- Words advance far more slowly. Only spaced encounters count now: a word shown again before its gap has elapsed is a reminder and earns nothing, where before every marked word counted and a busy day could run a word through its whole schedule. The gaps are longer (the second look eight hours on, then a day, two, three, five, a week) and the thresholds higher: at the steady pace a word flips after eight counted encounters instead of four and goes bare after fourteen instead of eight; known needs eight bare encounters instead of five. In practice the first flip comes after about four weeks and the first bare word after about ten. A word that flipped under the old threshold goes back to side by side until it earns the flip.
- More words may sit in rotation at once (sixteen at level 0, growing with the level), so new words keep arriving while the older ones wait out their spacing.

## 0.2.4 (2026-10-19)
- A new stage sits between side by side and bare. Halfway to bare a word flips: the new word comes first, in italics, with your word in the brackets after it, so "yes **[sí]**" becomes "*sí* **[yes]**" before it becomes "*sí*". The flip happens after four of the eight side-by-side encounters at the steady pace; the total before a word goes bare is unchanged. Flipped words have their own line in the turn plan, a rule in the lesson, a toast when they flip, and show as their own group in `/contextlang words` and the status line. Words already met flip at their next encounter if they are past the halfway mark.
- The script lesson is much slower. A new letter used to arrive every reply; now one arrives only while at most two letters (three at brisk, one at gentle) are still short of their repetitions, so a steady learner meets a letter every four or five replies and sees each one through its spaced reviews before the next. A footer carries at most two letters, reviews first. When no letter is due and there is no room for a new one, the footer is a sound note or a phrase with its reading instead.

## 0.2.3 (2026-10-19)
- The lesson now tells Claude to keep drafted text clean: an email, Slack message, GitHub comment, pull request, ticket, commit message or documentation written for you to send as your own gets no woven words and no footer, since those would go out under your name.
- In the script phase, a word is only woven in once every letter in it has been taught in the footer, so the first words are ones you can sound out (да after А and Д) rather than a whole word in an unfamiliar alphabet. A word met earlier waits until its letters have been shown. Hangul syllables count by their jamo and voiced or small kana by their base kana; kanji wait for the words phase.

## 0.2.2 (2026-10-19)
- A misspelled language is pointed out at session start ("Russain" is not a language it knows. Did you mean Russian?) and no pack is generated for it until the next session, so a typo no longer costs tokens.
- An unreadable birth date is pointed out at session start with the accepted format, instead of being silently ignored.
- `/contextlang status` now ends with a "Settings as read" line: the language as typed and what it resolved to, whether the pack is shipped or generated, birth date and age, pace, marker and pack model.

## 0.2.1 (2026-10-19)
- The script lesson now introduces one new letter per reply instead of three. Letters that are due for review come back alongside it as just their sound, so the footer stays short and the repeats are what you see most.

## 0.2.0 (2026-10-19)
- Eight more languages ship as curated packs, each mirroring the Spanish concept list so every pack covers the same ground: French, German, Italian, Portuguese, Japanese, Korean, Mandarin and Russian. The non-Latin packs carry a reading on every entry and their own sound and structure notes. Nobody generates these nine.
- `/contextlang export [path]` writes the generated pack for your language as a source file in the shape of the shipped packs, ready to review and contribute.
- A pack now belongs to a (language, native language) pair: shipped packs are glossed in English and serve English speakers; anyone else gets a generated pack. Packs stored under the old key are still read for English speakers.
- Generating a pack tells you which model is building it and roughly how many tokens it takes. A new `pack model` setting picks that model (Sonnet by default, `session` for the session's own); if it cannot answer, the session model is tried.
- Fix: a few command replies said "ctx.pack" and "ctx.progress" instead of "pack" and "progress".
- Fix: a language whose pack had no sounds yet (one still being generated) started at level 5.71 with 20 free points instead of 0. Progress and level were already kept per language; a test now pins that down.
- The age setting is now a date of birth (`birth_date`, `YYYY-MM-DD`), so your age is worked out each session instead of going stale. The old `age` number is no longer read; enter your date of birth in `/config`.
- The footer line styles its target-language words with the marker style (bold by default) without brackets: `In Spanish, **ñ** sounds like..., as in **año** (year)`.
- Fix: the report tool returned an object result, which the engine refuses; it now returns its summary as text.
- Marker styles: `bold` (new default), `italic`, `code` and plain `brackets` for the side-by-side word, so it stands out in the terminal. Crediting now reads a code-styled marker inside inline code.

## 0.1.0

First release.

- Weaves side-by-side words, then bare words, then phrases and sentences of the target language into Claude's final replies, paced by a spaced-repetition schedule.
- Curated Spanish pack (over 400 words, 45 phrases, 14 sounds). Any other language gets a pack generated by the model on first use and extended as the learner advances.
- Script-first phase for Japanese (hiragana and katakana), Korean (hangul), Mandarin (pinyin tones) and Cyrillic languages.
- `/contextlang` command: status, words, pause, resume, forgot, know, level, reset.
- A report tool the model calls when you write the target language, so correct use counts and mistakes bring a word back.
- Optional progress band above the prompt.
