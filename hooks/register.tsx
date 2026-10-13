import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionCost, SessionRateLimit } from 'claude-code'

import type { CacheMark, Piece, Tone, View } from '../types'

const view = atom({ plugin: 'composer-meter', key: 'view' } as const, { cost: null, cache: null })
const mark = atom({ plugin: 'composer-meter', key: 'mark' } as const, null)
const isSubscription = atom({ plugin: 'composer-meter', key: 'isSubscription' } as const, false)

const MINUTE = 60_000
const WARN_MS = 4 * MINUTE
const DANGER_MS = 2 * MINUTE

/** Base input $/MTok by model id, most specific first (list prices, 2026-10). */
const INPUT_PRICES: readonly [RegExp, number][] = [
  [/fable-5|mythos-5/, 10],
  [/opus-5-5/, 4],
  [/opus-5|opus-4-[5-9]/, 5],
  [/opus-4|opus-3/, 15],
  [/sonnet-5/, 2],
  [/sonnet/, 3],
  [/haiku-5-5/, 0.1],
  [/haiku-4-5/, 1],
  [/haiku-3-5/, 0.8],
  [/haiku/, 0.25],
]

export function inputPrice(model: string, tokens: number): number {
  // Haiku 5.5 doubles past a 100K-token prompt.
  if (/haiku-5-5/.test(model) && tokens > 100_000) return 0.5
  return INPUT_PRICES.find(([re]) => re.test(model))?.[1] ?? 5
}

export function coldWriteUsd(m: CacheMark, ttlMs: number): number {
  const multiplier = ttlMs > 5 * MINUTE ? 2 : 1.25
  return (m.tokens / 1e6) * inputPrice(m.model, m.tokens) * multiplier
}

const usd = (n: number) => (n < 10 ? `$${n.toFixed(2)}` : `$${n.toFixed(1)}`)

export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export const costPiece = (cost: SessionCost | undefined): Piece | null =>
  cost ? { text: usd(cost.usd), tone: 'normal' } : null

export function cachePiece(m: CacheMark | null, ttlMs: number, now: number): Piece | null {
  if (!m) return null
  const expiresAt = m.startedAt + ttlMs
  const left = expiresAt - now
  if (left <= 0) return { text: `cold ~${usd(coldWriteUsd(m, ttlMs))}`, tone: 'error' }
  const tone: Tone = left <= DANGER_MS ? 'error' : left <= WARN_MS ? 'warning' : 'normal'
  return { text: `TTL ends ${clock(expiresAt)}`, tone }
}

const same = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b)

let ttlOption = 'auto'

async function ttlMs($: EngineInterface): Promise<number> {
  if (ttlOption === '5m') return 5 * MINUTE
  if (ttlOption === '1h') return 60 * MINUTE
  return (await read($, isSubscription)) ? 60 * MINUTE : 5 * MINUTE
}

async function setView($: EngineInterface, patch: Partial<View>): Promise<void> {
  await update($, view, prev => {
    const next = { ...prev, ...patch }
    return same(prev, next) ? prev : next
  })
}

async function showMeter(
  $: EngineInterface,
  rateLimits: readonly SessionRateLimit[],
  cost: SessionCost | undefined,
): Promise<void> {
  // Rate-limit windows are reported only on a subscription, which caches for 1h.
  if (rateLimits.length > 0) await update($, isSubscription, () => true)
  await setView($, { cost: costPiece(cost) })
}

// Runs after a gating hook's next(): never throws, so a failed read cannot fail the prompt or tool call.
async function refreshMeter($: EngineInterface): Promise<void> {
  try {
    const { rateLimits, cost } = await $.session.usage()
    await showMeter($, rateLimits, cost)
  } catch {}
}

async function refreshCache($: EngineInterface): Promise<void> {
  const piece = cachePiece(await read($, mark), await ttlMs($), await $.clock.now())
  await setView($, { cache: piece })
}

export const register: Register = (on, options) => {
  ttlOption = String(options.cacheTtl ?? 'auto')

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refreshMeter($)
    await refreshCache($)
    $.clock.every(1000, () => void refreshCache($))
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    await refreshMeter($)
    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    await refreshMeter($)
    return result
  })

  on('session.measure', async ($, e, next) => {
    await showMeter($, e.rateLimits, e.cost)
    return next(e)
  })

  // The cache lifetime runs from the start of each main-thread request that reads or writes it.
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const result = yield* next(e)
    if (!e.agentId && result.usage) {
      const u = result.usage
      const tokens =
        u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
      await update($, mark, () => ({ startedAt, model: u.model, tokens }))
      await refreshCache($)
    }
    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, mark, () => null)
      await setView($, { cache: null })
    }
    return next(e)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    // The desktop flattens this slot to one line of inline text: Text and plain strings only.
    const { cost = null, cache = null } = await read($, view)
    const pieces = [cost, cache].filter((p): p is Piece => p !== null)
    if (pieces.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const color = (tone: Tone) => (tone === 'normal' ? undefined : tone)

    return (
      <Box flexDirection="row">
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')} · </Text>}
        {pieces.map((p, i) => (
          <Text key={`p${i}`} color={color(p.tone)} dimColor={p.tone === 'normal'}>
            {i > 0 ? ' · ' : ''}
            {p.text}
          </Text>
        ))}
      </Box>
    )
  })
}
