export type Tone = 'normal' | 'warning' | 'error'

export type Piece = { text: string; tone: Tone }

/** The last main-thread request: when it started and what a cold re-cache would write. */
export type CacheMark = { startedAt: number; model: string; tokens: number }

export type View = { cost: Piece | null; cache: Piece | null }

declare module 'claude-code' {
  interface PluginState {
    'composer-meter': { view: View; mark: CacheMark | null; isSubscription: boolean }
  }
}
