export type Tone = 'normal' | 'warning' | 'error'

export type Piece = { text: string; tone: Tone }

/** The last main-thread request: when it started and what a cold re-cache would write. */
export type CacheMark = { startedAt: number; model: string; tokens: number }

export type View = { cost: Piece | null; cache: Piece | null }

/** Context fill and each plan limit spent, in percent, for the terminal's band. */
export type UsageSnap = { context: number | null; limits: { label: string; percent: number }[] }

/** The main loop's model, and its effort (null until known, or for a model without effort). */
export type ModelSnap = { model: string; effort: string | null }

/**
 * Where the session is, for the terminal footer's right: its directory (home as `~`) and
 * git's HEAD as a label, null outside a repository. `path` is '' until first read.
 */
export type PlaceSnap = { path: string; head: string | null }

/** The engine's base input $/MTok for a model, learned from a model switch; `isLong` past 100K tokens. */
export type EnginePrice = { model: string; perMTok: number; isLong: boolean }

declare module 'claude-code' {
  interface PluginState {
    'composer-meter': {
      view: View
      mark: CacheMark | null
      isSubscription: boolean
      usage: UsageSnap
      model: ModelSnap
      place: PlaceSnap
      price: EnginePrice | null
      isLight: boolean
    }
  }
}
