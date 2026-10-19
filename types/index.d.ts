export type ContextlangBand = {
  language: string
  level: number
  words: number
  phase: string
  isPaused: boolean
}

declare module 'claude-code' {
  interface PluginState {
    contextlang: { band: ContextlangBand | null }
  }
}
