# ContextLang

A [Claude Code](https://code.claude.com) plugin that teaches you a language while you work. There is no lesson mode and nothing to schedule. Claude keeps answering in your language, and a little of the language you are learning rides along in each reply: one or two words at first, side by side with their meaning, then bare words you have seen enough times, then short phrases, then sentences, until most of the reply is in the new language. Progress is tracked per word on a spaced-repetition schedule and kept between sessions.

A first-day reply, English to Spanish, looks like this:

> Got it! I'll start on that plugin right now. Before I do, I have a few questions [preguntas] to ask:
>
> 1. What does the setup process need to include?
> 2. Can the user see a status of what they've learned so far?
>
> ContextLang: In Spanish, ñ sounds like the "ny" in canyon, as in año (year), mañana (tomorrow).

A month in, the same kind of reply carries a handful of words you already know with no translation, a short phrase, and a word or two that are new.

## What you get

- **Words in context, never a quiz.** A side-by-side word is written as your word followed by the new word in brackets, where the meaning naturally occurs. Claude inflects it to fit the sentence. If a planned word would not fit, Claude skips it rather than forcing it.
- **Words go bare once you know them.** After enough spaced encounters a word is shown on its own, in italics, in place of your word. After enough bare encounters it counts as known and Claude may use it freely. Say "I don't know *ahora*" or ask what a word means and it comes back with its translation.
- **A footer that teaches sounds and phrases.** The last line of a reply, `ContextLang: ...`, teaches a letter and its sound at the start, then short conversational phrases. It comes every reply at first and every second or third reply later.
- **Mixing languages is encouraged.** Write any of the new language in your prompt and Claude judges it: a word of praise when it is right, the corrected form when it is not. Correct use counts for more than reading, so your level moves faster when you try.
- **Only the final reply.** Nothing is woven into progress notes while Claude works, tool calls, commit messages, code, commands, paths, identifiers, or anything you might copy.
- **A granular level, 0 to 100 with decimals,** computed from how well each word, phrase and sound is known, and seven phases that decide how much of a reply is in the new language.
- **Any language.** Spanish ships with a curated pack. For any other language the plugin asks the model for a frequency-ordered pack on first use and extends it as you advance. Japanese, Korean, Mandarin and Cyrillic languages begin with a script phase that teaches the writing system before words are woven in.
- **`/contextlang`** shows your status, lists your words, pauses, resets, and lets you mark a word forgotten or known.

## Installation

Try it for one session:

```bash
git clone https://github.com/solepixel/contextual-language-learning.git
claude --plugin-dir ./contextual-language-learning
```

Install it:

```
/plugin install contextlang --marketplace solepixel/contextual-language-learning
```

Then open `/config`, find the ContextLang rows, and set the language you want to learn. Spanish is the default.

Requirements: Claude Code 2.1.303 or newer, the build this was written against (the plugin is a hooks module, not a shell-command hook, and that API is early access).

## Settings

All of these are rows in `/config`.

| Setting | Default | What it does |
| --- | --- | --- |
| Language to learn | Spanish | By name: Spanish, French, Japanese, Korean, and so on. |
| Your language | English | The language replies stay in until the new one has earned its way in. |
| Your age | 0 (unset) | Under 10 and over 60 get a lighter density and more repetition per word; teens a little of each. |
| Pace | steady | `gentle`, `steady` or `brisk`: how quickly new words arrive and how dense a reply gets. |
| Marker style | bold | How the translated word stands out: `bold` gives **[preguntas]**, `italic` gives *[preguntas]*, `code` gives `[preguntas]` (colored in the terminal), `brackets` gives plain [preguntas]. |
| Show progress band | off | A one-line band above the prompt with your level and word count. |
| Enabled | on | Turn it off without losing progress. |

Progress is kept per language in the plugin's own store, so switching languages and back loses nothing.

## The command

| Command | What it does |
| --- | --- |
| `/contextlang` | Level, phase, counts, what is due now. |
| `/contextlang words` | Every word you have met, grouped by stage, with how often you have seen it. |
| `/contextlang forgot <word>` | Back to side by side, half its credit kept. Saying "I don't know <word>" in a prompt does the same. |
| `/contextlang know <word>` | Straight to bare, or from bare to known. |
| `/contextlang pause` and `resume` | Stop and start without losing anything. |
| `/contextlang level <n>` | Pin the level (0 to 100) to try a phase; `level auto` lets progress set it again. |
| `/contextlang reset confirm` | Erase this language's progress. |

## How it paces you

The design follows what the second-language research supports rather than a fixed syllabus.

- **Comprehensible input.** Everything new arrives inside text you already understand, a word or two at a time (Krashen's input hypothesis, the "i+1" idea). The method of replacing single words in a text you can read, and replacing more as you go, is the diglot weave (Burling, 1968).
- **Encounters, not drills.** Incidental vocabulary studies put learning a word's form and meaning at roughly six to sixteen encounters, with most of the gain by about ten (Nation, 2001; Webb, 2007). A word goes bare after eight side-by-side encounters at the steady pace, and counts as known after five bare ones.
- **Spacing.** Each encounter pushes a word's next due time out on an expanding schedule, both in turns (1, 2, 3, 5, 8, 13, 21) and in hours (0, 0, 1, 4, 12, 24, 72), so a long day of prompting cannot burn through a word's schedule in one sitting (Pimsleur, 1967; Cepeda et al., 2006). Bare words stop stretching at eight turns and a day, since they are cheap to show.
- **Output counts more than input.** Using a word correctly in your own prompt is worth more than reading it, and three correct uses take a word from bare to known (Swain's output hypothesis).
- **Frequency first.** Words arrive in frequency order, everyday language before anything else; the level is scored against the roughly two thousand word families that cover most everyday text (Nation). Programming vocabulary unlocks at level 25 and specialist computing vocabulary at 50, so technical words wait until they will not get in the way.
- **Scripts before words.** For Japanese, Korean, Mandarin and Cyrillic languages the first phase teaches the script in the footer, three symbols at a time, and weaves in at most one word per reply, with its reading. The reading drops once most of the script is known.
- **Age.** Learning ability stays high until the late teens and declines slowly after (Hartshorne et al., 2018). Younger children and older adults get a lighter density and more encounters per word; the optional age setting is a nudge, not a gate.

Phases by level:

| Level | Phase | What a reply looks like |
| --- | --- | --- |
| 0 to 5 | sounds | Your language. One or two side-by-side words. A sound in every footer. |
| 5 to 20 | words | Side-by-side words plus bare ones you know. Greetings may be in the new language. |
| 20 to 45 | phrases | One short sentence or clause in the new language per reply, with its meaning. |
| 45 to 70 | sentences | A quarter to a half of plain sentences in the new language; no translation when every word is known. |
| 70 to 90 | immersion | About three sentences in four. Technical explanation may fall back to your language. |
| 90 to 100 | fluent | The whole reply, apart from code, commands, paths and quoted errors. |

Simulated at forty prompts a day with Claude following every plan, the steady pace meets about ten words on the first day, around sixty by day ten and over three hundred and fifty by day sixty, reaching the phrases phase after about three weeks. Brisk runs roughly a third faster and gentle a third slower. Real sessions vary: Claude skips a word that would not fit, you forget some, and using words yourself moves you faster.

## How it works

The plugin is a Claude Code hooks module (`hooks/register.tsx`) over a pure engine (`hooks/engine.ts`).

| Hook | What the plugin does |
| --- | --- |
| `session.start` | Loads this language's progress and pack from the store, registers `/contextlang` and the report tool, and generates a pack if the language has none. |
| `prompt.compose` | Appends one section to the system prompt: the rules of the weave, the current phase's guidance, and the words you already know. It is rebuilt only when your level crosses a five-point bucket, so the prompt cache holds across a session. |
| `prompt.submit` | Attaches a hidden note beside your prompt: the words to weave in this reply, the footer text, and anything you wrote in the new language. Per-turn variation lives here, not in the system prompt. |
| `turn.complete` | Reads the final reply, credits every planned word it carried (brackets for side by side, a plain or italic match for bare, the `ContextLang:` line for the footer), advances their schedules, and saves. Code blocks are ignored. |
| `tool.call` on `mcp__contextlang__report` | Claude calls this when you wrote the new language or said you did not know a word: correct use is credited, mistakes pull a word back, forgotten words return to side by side. |
| `command.run` on `contextlang` | The command above. |
| `ui.render` on `AbovePrompt` | The optional band. |

Two things keep it honest. Progress is credited from what actually appeared in the reply, not from what was planned, so a word Claude skipped is not counted. And a word is due only when both its turn interval and its hour interval have passed.

### Packs

`hooks/packs/es.ts` is the curated Spanish pack: over four hundred words ordered by usefulness in everyday talk and in a coding assistant's replies, forty-five phrases with the level they unlock at, and fourteen letter-and-sound notes. `hooks/packs/scripts.ts` holds the hiragana, katakana, hangul, pinyin and Cyrillic primers and sound notes for French, German, Italian and Portuguese.

Any other language gets its pack from one model call on first use (`hooks/packs/generate.ts`): a frequency-ordered list with meanings, tiers, readings for non-Latin scripts, phrases and, where no primer ships, sound notes. The reply is parsed defensively and stored; when the pack runs low for your level, the next hundred words are fetched in the background. A pack is kept separately from progress, so a reset keeps it.

Contributions of curated packs for other languages are welcome: copy the shape of `es.ts`, add the language to `SHIPPED` in `hooks/packs/index.ts`, and the tests will check for duplicate keys.

## Development

```bash
claude plugin validate .   # manifest and hooks module, as the engine reads them
claude plugin test .       # tests/*.test.ts against the engine's own test kit
```

Type-check with `tsc -p .` once the engine has laid its declarations in `.claude-plugin/types/` (it does so whenever it loads the plugin from this folder).

## License

MIT
