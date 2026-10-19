import type { Pack } from '../engine'
import { mergePack } from '../engine'
import type { Generated } from './generate'

// Turns a pack the model generated into the source of a shipped pack, in the
// shape of es.ts and ru.ts, so a learner can review it and contribute it.
// A shipped pack costs every later learner nothing to build.

const q = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function entry(o: Record<string, unknown>, keys: string[]): string {
  const parts = keys.filter(k => o[k] !== undefined && o[k] !== '').map(k => `${k}: ${typeof o[k] === 'number' ? String(o[k]) : q(String(o[k]))}`)
  return `    { ${parts.join(', ')} },`
}

/** TypeScript source for `pack` with `extra` (what the model generated) merged in, ready for hooks/packs/<code>.ts. */
export function packSource(pack: Pack, extra?: Generated): string {
  const p = mergePack(pack, extra)
  const ident = p.code.replace(/[^a-z0-9]/gi, '_').replace(/^(\d)/, '_$1')
  const lines = [
    `import type { Pack } from '../engine'`,
    ...(p.scriptItems && p.scriptItems.length > 0 ? [`import { scriptFor } from './scripts'`] : []),
    ``,
    `// ${p.name} glossed in ${p.native}, exported by /contextlang export. Review the`,
    `// spelling, tiers, readings and notes, then save it as hooks/packs/${p.code}.ts and`,
    `// add it to SHIPPED in hooks/packs/index.ts so nobody has to generate it again.`,
    ``,
    `export const ${ident}: Pack = {`,
    `  code: ${q(p.code)},`,
    `  native: ${q(p.native)},`,
    `  name: ${q(p.name)},`,
    `  nativeName: ${q(p.nativeName)},`,
    `  script: ${q(p.script)},`,
    `  words: [`,
    ...p.words.map(w => entry(w as Record<string, unknown>, ['t', 'n', 'tier', 'reading', 'note'])),
    `  ],`,
    `  phrases: [`,
    ...p.phrases.map(w => entry(w as Record<string, unknown>, ['t', 'n', 'minLevel', 'reading', 'note'])),
    `  ],`,
    `  alphabet: [`,
    ...p.alphabet.map(a => entry(a as Record<string, unknown>, ['symbol', 'sound', 'example'])),
    `  ],`,
    ...(p.scriptItems && p.scriptItems.length > 0 ? [`  scriptItems: scriptFor(${q(p.code)}).scriptItems,`] : []),
    `}`,
    ``,
  ]
  return lines.join('\n')
}
