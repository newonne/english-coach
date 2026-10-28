export type Correction = {
  id: string
  at: number
  original: string
  corrected: string
  notes: string[]
}

export type Stats = { checked: number; perfect: number }

declare module 'claude-code' {
  interface PluginState {
    'english-coach': {
      corrections: Shaped<Correction[]>
      stats: Shaped<Stats>
      checking: number
    }
  }
}
