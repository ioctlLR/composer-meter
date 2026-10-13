import type { SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Tone, UsageSnap } from '../types'

// The terminal's band above the prompt: block meters for the context window and each
// plan limit, as ▰▰▰▱▱▱▱▱ 37% context.

export type Meter = { label: string; percent: number; bar: string; tone: Tone }

const CELLS = 8

// `five_hour` reads as `5h`, `seven_day` as `7d`; any other kind as its own name.
export function limitLabel(kind: string): string {
  const name = kind.toLowerCase()

  if (name.includes('five') || name.includes('5h') || name.includes('5_h')) return '5h'
  if (name.includes('seven') || name.includes('7d') || name.includes('week')) return '7d'
  return name.replace(/_/g, ' ')
}

export const usageSnap = (context: SessionContextUsage, rateLimits: readonly SessionRateLimit[]): UsageSnap => ({
  context: context.percent ?? null,
  limits: rateLimits.map(limit => ({ label: limitLabel(limit.kind), percent: limit.percentUsed })),
})

// The plan's own windows, which the session's cost can stand in for.
const PLAN_WINDOWS = new Set(['5h', '7d'])

// Plain while there is room; warning from 80%, error from 95%.
export const meterTone = (percent: number): Tone => (percent >= 95 ? 'error' : percent >= 80 ? 'warning' : 'normal')

export function metersOf(usage: UsageSnap, showPlan: boolean): Meter[] {
  return [
    ...(usage.context === null ? [] : [{ label: 'context', percent: usage.context }]),
    ...usage.limits.filter(limit => showPlan || !PLAN_WINDOWS.has(limit.label)),
  ].map(({ label, percent }) => {
    const p = Math.max(0, Math.min(100, Math.round(percent)))
    const filled = Math.round((p / 100) * CELLS)
    return { label, percent: p, bar: '▰'.repeat(filled) + '▱'.repeat(CELLS - filled), tone: meterTone(p) }
  })
}

const FAMILY = 'opus|sonnet|haiku|fable|mythos'
const NEW_ID = new RegExp(`claude-(${FAMILY})-(\\d+)(?:-(\\d{1,2}))?(?!\\d)`)
const OLD_ID = new RegExp(`claude-(\\d+)(?:-(\\d{1,2}))?-(${FAMILY})`)

const titled = (family: string) => family[0]!.toUpperCase() + family.slice(1)

// The model as a person reads it: `claude-opus-5-5[1m]` as `Opus 5.5`. The engine gives the
// id alone. Bedrock and Vertex prefixes, date suffixes and the context-window tag drop; an
// id that is not Claude's shows as given.
export function modelName(id: string): string {
  const lower = id.toLowerCase()
  const modern = NEW_ID.exec(lower)
  if (modern) return `${titled(modern[1]!)} ${modern[2]}${modern[3] ? `.${modern[3]}` : ''}`
  const legacy = OLD_ID.exec(lower)
  if (legacy) return `${titled(legacy[3]!)} ${legacy[1]}${legacy[2] ? `.${legacy[2]}` : ''}`
  return id
}

// skins-plus's Dracula colours, its light variant deepened to read on white.
export type BandColors = { accent: string; fg: string; muted: string }
export const BAND_DARK: BandColors = { accent: '#bd93f9', fg: '#f8f8f2', muted: '#6272a4' }
export const BAND_LIGHT: BandColors = { accent: '#685189', fg: '#1f1f1f', muted: '#6b6b6b' }
