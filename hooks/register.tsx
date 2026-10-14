import { atom, read, update } from 'claude-code'
import type {
  ConfigRow,
  EngineInterface,
  Register,
  SessionContextUsage,
  SessionCost,
  SessionRateLimit,
} from 'claude-code'

import type { CacheMark, EnginePrice, ModelSnap, Piece, PlaceSnap, Tone, UsageSnap, View } from '../types'
import { BAND_DARK, BAND_LIGHT, metersOf, modelName, usageSnap } from './band'
import { fitPlace, gitDirOf, headLabel, homePath, parentOf, slashed } from './place'
import { lastRequestIn } from './transcript'
import { widthOf } from './width'

const view = atom({ plugin: 'composer-meter', key: 'view' } as const, { cost: null, cache: null })
const mark = atom({ plugin: 'composer-meter', key: 'mark' } as const, null)
const isSubscription = atom({ plugin: 'composer-meter', key: 'isSubscription' } as const, false)
const usage = atom({ plugin: 'composer-meter', key: 'usage' } as const, { context: null, limits: [] } as UsageSnap)
const model = atom({ plugin: 'composer-meter', key: 'model' } as const, { model: '', effort: null } as ModelSnap)
const place = atom({ plugin: 'composer-meter', key: 'place' } as const, { path: '', head: null } as PlaceSnap)
const price = atom({ plugin: 'composer-meter', key: 'price' } as const, null as EnginePrice | null)
const isLight = atom({ plugin: 'composer-meter', key: 'isLight' } as const, false)
// The session whose transcript was last looked in for a cache mark; reset with the rest of
// the state, so a reset session is looked up again.
const seededFor = atom({ plugin: 'composer-meter', key: 'seededFor' } as const, null as string | null)

const MINUTE = 60_000
const WARN_MS = 4 * MINUTE
const DANGER_MS = 2 * MINUTE

/** Base input $/MTok by model id, most specific first (list prices, 2026-10). */
// The fallback: the engine's own catalog reaches a mod only on a model switch (EnginePrice).
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

const LONG_PROMPT = 100_000

const writeMultiplier = (ttlMs: number) => (ttlMs > 5 * MINUTE ? 2 : 1.25)

const bareId = (id: string) => id.toLowerCase().replace(/\[.*\]$/, '')

export function inputPrice(model: string, tokens: number, engine: EnginePrice | null = null): number {
  // The engine's figure holds for its model, on the same side of the long-prompt tier.
  if (engine && bareId(engine.model) === bareId(model) && engine.isLong === tokens > LONG_PROMPT) return engine.perMTok
  // Haiku 5.5 doubles past a 100K-token prompt.
  if (/haiku-5-5/.test(model) && tokens > LONG_PROMPT) return 0.5
  return INPUT_PRICES.find(([re]) => re.test(model))?.[1] ?? 5
}

export function coldWriteUsd(m: CacheMark, ttlMs: number, engine: EnginePrice | null = null): number {
  return (m.tokens / 1e6) * inputPrice(m.model, m.tokens, engine) * writeMultiplier(ttlMs)
}

// A model switch reports what re-caching its context costs on the new model, from the
// engine's catalog or the managed pricing: the base input price, with the write multiplier
// for the TTL it assumed divided out. Null when the engine did not know the model.
export function enginePrice(e: {
  to_model: string
  context_tokens: number
  cache_ttl: '5m' | '1h'
  estimated_cache_write_usd: number
  pricing: 'configured' | 'catalog' | 'default'
}): EnginePrice | null {
  if (e.pricing === 'default' || e.context_tokens <= 0 || !(e.estimated_cache_write_usd > 0)) return null
  const multiplier = writeMultiplier(e.cache_ttl === '1h' ? 60 * MINUTE : 5 * MINUTE)
  const perMTok = (e.estimated_cache_write_usd / e.context_tokens) * 1e6 / multiplier
  return { model: e.to_model, perMTok, isLong: e.context_tokens > LONG_PROMPT }
}

const usd = (n: number) => (n < 10 ? `$${n.toFixed(2)}` : `$${n.toFixed(1)}`)

export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export const costPiece = (cost: SessionCost | undefined): Piece | null =>
  cost ? { text: usd(cost.usd), tone: 'normal' } : null

export function cachePiece(
  m: CacheMark | null,
  ttlMs: number,
  now: number,
  engine: EnginePrice | null = null,
): Piece | null {
  if (!m) return null
  const expiresAt = m.startedAt + ttlMs
  const left = expiresAt - now
  if (left <= 0) return { text: `cold ~${usd(coldWriteUsd(m, ttlMs, engine))}`, tone: 'error' }
  const tone: Tone = left <= DANGER_MS ? 'error' : left <= WARN_MS ? 'warning' : 'normal'
  return { text: `TTL ends ${clock(expiresAt)}`, tone }
}

const color = (tone: Tone) => (tone === 'normal' ? undefined : tone)

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

type Measured = { context: SessionContextUsage; rateLimits: readonly SessionRateLimit[]; cost?: SessionCost }

async function showMeter($: EngineInterface, { context, rateLimits, cost }: Measured): Promise<void> {
  // Rate-limit windows are reported only on a subscription, which caches for 1h.
  if (rateLimits.length > 0) await update($, isSubscription, () => true)
  await setView($, { cost: costPiece(cost) })
  const snap = usageSnap(context, rateLimits)
  await update($, usage, prev => (JSON.stringify(prev) === JSON.stringify(snap) ? prev : snap))
}

// Runs after a gating hook's next(): never throws, so a failed read cannot fail the prompt or tool call.
async function refreshMeter($: EngineInterface): Promise<void> {
  try {
    await showMeter($, await $.session.usage())
  } catch {}
}

const EFFORT_ROW = /effort/i

// Claude Code's theme names say light or dark in them: `light`, `light-daltonized`, ...
async function refreshTheme($: EngineInterface): Promise<void> {
  try {
    const theme = (await $.config.list()).find(row => row.key === 'theme')?.value
    const light = typeof theme === 'string' && theme.includes('light')
    await update($, isLight, () => light)
  } catch {}
}

// The effort /config holds, until the next main-thread request says what it really sent.
async function configEffort($: EngineInterface): Promise<string | null> {
  const rows = await $.config.list().catch(() => [] as ConfigRow[])
  const value = rows.find(row => EFFORT_ROW.test(row.key) || EFFORT_ROW.test(row.label))?.value
  return typeof value === 'string' && value !== '' ? value : null
}

// A host that cannot say keeps the last value: the model line is a nicety.
async function refreshModel($: EngineInterface): Promise<void> {
  try {
    const id = await $.session.model().catch(() => null)
    const effort = await configEffort($)
    await update($, model, snap => ({ model: id ?? snap.model, effort: effort ?? snap.effort }))
  } catch {}
}

// Walks up from `cwd` to the first `.git` and reads its HEAD; null outside a repository.
// Reads the files git keeps, so no git process runs.
async function headOf($: EngineInterface, cwd: string): Promise<string | null> {
  for (let at: string | null = slashed(cwd); at !== null; ) {
    const dir: string = at
    at = parentOf(dir)
    const dotGit = `${dir === '/' ? '' : dir}/.git`
    const stat = await $.fs.stat(dotGit).catch(() => null)
    if (stat === null) continue

    const gitDir = stat.kind === 'dir' ? dotGit : stat.kind === 'file' ? gitDirOf(await $.fs.read(dotGit), dir) : null
    const head = gitDir === null ? null : await $.fs.read(`${gitDir}/HEAD`).catch(() => null)
    return head === null ? null : headLabel(head)
  }
  return null
}

// The directory and branch move on a /cd, a checkout or a worktree switch; a failed read keeps the last.
async function refreshPlace($: EngineInterface): Promise<void> {
  try {
    const cwd = await $.session.cwd()
    const home = (await $.env.get('HOME').catch(() => undefined)) ?? (await $.env.get('USERPROFILE').catch(() => undefined))
    const next: PlaceSnap = { path: homePath(cwd, home ?? undefined), head: await headOf($, cwd).catch(() => null) }
    await update($, place, snap => (snap.path === next.path && snap.head === next.head ? snap : next))
  } catch {}
}

// A resumed or forked conversation's last request, from its transcript; past the 4 MiB a
// mod may read, from the engine's report of its last response (a little later than the send).
async function resumedMark(
  $: EngineInterface,
  e: { transcript_path?: string; model?: string; seconds_since_last_response?: number; context_tokens?: number },
): Promise<CacheMark | null> {
  const text = e.transcript_path ? await $.fs.read(e.transcript_path).catch(() => null) : null
  const fromFile = text === null ? null : lastRequestIn(text)
  if (fromFile) return fromFile

  const seconds = e.seconds_since_last_response
  const tokens = e.context_tokens
  if (seconds === undefined || !tokens) return null
  const model = e.model ?? (await $.session.model().catch(() => ''))
  return { startedAt: (await $.clock.now()) - seconds * 1000, model, tokens }
}

const slug = (path: string) => path.replace(/[^a-zA-Z0-9]/g, '-')

async function exists($: EngineInterface, path: string): Promise<boolean> {
  return (await $.fs.stat(path).catch(() => null))?.kind === 'file'
}

// The session's transcript, <config dir>/projects/<its directory, slugged>/<id>.jsonl. A long
// directory's slug is cut and hashed, so past the two guesses every project folder is tried.
async function transcriptOf($: EngineInterface, id: string): Promise<string | null> {
  const home = (await $.env.get('HOME').catch(() => null)) || (await $.env.get('USERPROFILE').catch(() => null))
  const config = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => null)) || (home ? `${slashed(home)}/.claude` : null)
  if (!config) return null

  const projects = `${slashed(config)}/projects`
  const guesses = [await $.session.root().catch(() => null), await $.session.cwd().catch(() => null)]
  for (const dir of new Set(guesses.filter((d): d is string => d !== null).map(slug))) {
    if (await exists($, `${projects}/${dir}/${id}.jsonl`)) return `${projects}/${dir}/${id}.jsonl`
  }
  for (const entry of await $.fs.list(projects).catch(() => [])) {
    if (entry.kind === 'dir' && (await exists($, `${projects}/${entry.name}/${id}.jsonl`))) {
      return `${projects}/${entry.name}/${id}.jsonl`
    }
  }
  return null
}

// A state reset (the desktop letting an idle session's process go, a reload) empties the
// mark while the cost refreshes at once; the transcript says when the last request went out.
// Looked up once per session id, and never over a mark a request set meanwhile.
async function seedMark($: EngineInterface): Promise<void> {
  if ((await read($, mark)) !== null) return
  const id = await $.session.id().catch(() => null)
  if (id === null || (await read($, seededFor)) === id) return
  await update($, seededFor, () => id)

  const path = await transcriptOf($, id)
  const text = path === null ? null : await $.fs.read(path).catch(() => null)
  const found = text === null ? null : lastRequestIn(text)
  if (found) await update($, mark, prev => prev ?? found)
}

async function refreshAll($: EngineInterface): Promise<void> {
  await refreshMeter($)
  await refreshModel($)
  await refreshPlace($)
  await refreshTheme($)
  await refreshCache($)
}

async function refreshCache($: EngineInterface): Promise<void> {
  await seedMark($).catch(() => {})
  const piece = cachePiece(await read($, mark), await ttlMs($), await $.clock.now(), await read($, price))
  await setView($, { cache: piece })
}

export const register: Register = (on, options) => {
  ttlOption = String(options.cacheTtl ?? 'auto')
  // The terminal band shows the session's cost in place of the 5h and 7d meters.
  const bandShowsCost = (options.bandUsage ?? 'cost') === 'cost'

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refreshAll($)
    $.clock.every(1000, () => void refreshCache($))
    return started
  })

  // /clear, /resume and /branch reset $.state to its defaults and skip session.start. A
  // resumed or forked conversation's cache runs from its last request.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const result = await next(e)
    if (e.source !== 'clear') {
      const resumed = await resumedMark($, e).catch(() => null)
      await update($, mark, () => resumed)
    }
    await refreshAll($)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    await refreshMeter($)
    return result
  })

  on('turn.start', async ($, e, next) => {
    await refreshPlace($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await refreshPlace($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    await refreshMeter($)
    // A command may check out another branch or change directory.
    if (e.agentId === undefined && e.tool === 'Bash') await refreshPlace($)
    return result
  })

  on('classic.CwdChanged', async ($, e, next) => {
    const result = await next(e)
    await refreshPlace($)
    return result
  })

  on('config.set', async ($, e, next) => {
    const result = await next(e)
    if (e.key === 'model' || EFFORT_ROW.test(e.key)) await refreshModel($)
    if (e.key === 'theme') await refreshTheme($)
    return result
  })

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    await refreshModel($)
    return result
  })

  // Only the price is taken: the TTL stays ours, since the switch's cache_ttl is not
  // known to match what the requests write.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    await refreshModel($)
    const learned = enginePrice(e)
    if (learned) await update($, price, () => learned)
    return result
  })

  on('session.measure', async ($, e, next) => {
    await showMeter($, e)
    return next(e)
  })

  // The cache lifetime runs from the start of each main-thread request that reads or writes it.
  // The request also says the effort it really sent, after any downgrade for its model.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const effort = e.effort === undefined ? null : String(e.effort)
      await update($, model, snap => (snap.effort === effort ? snap : { ...snap, effort }))
    }
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

  // Terminal: the band above the prompt holds the meters, model and effort, and cache expiry.
  // The desktop draws its own context and model, so it keeps the engine's band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)

    const { cost, cache } = await read($, view)
    const meters = metersOf(await read($, usage), !bandShowsCost)
    const { model: id, effort } = await read($, model)
    const shownCost = bandShowsCost ? cost : null
    if (meters.length === 0 && shownCost === null && id === '' && cache === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const band = (await read($, isLight)) ? BAND_LIGHT : BAND_DARK
    const theirs = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={3}>
          {meters.map(m => (
            <Text key={m.label} color={band.muted}>
              <Text color={m.tone === 'normal' ? band.accent : m.tone}>{m.bar}</Text>
              {` ${m.percent}% ${m.label}`}
            </Text>
          ))}
          {shownCost && (
            <Text key="cost" color={band.muted}>
              <Text color={band.fg}>{shownCost.text}</Text> session
            </Text>
          )}
          {id !== '' && (
            <Text key="model" color={band.muted}>
              <Text color={band.fg}>{modelName(id)}</Text>
              {effort === null ? '' : ` · ${effort}`}
            </Text>
          )}
          {cache && (
            <Text key="cache" color={color(cache.tone) ?? band.muted}>
              {cache.text}
            </Text>
          )}
        </Box>
        {theirs}
      </Box>
    )
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface === 'terminal') {
      // The footer's right: the engine's mode labels, then the directory and branch. The
      // branch shows whole; the path gives way from its left, within half the width.
      const where = await read($, place)
      if (where.path === '') return next(e)

      const { Box, Text } = $.ui.resolve(e)
      const modes = e.props.modes.join(' & ')
      const budget = Math.floor((e.viewport?.columns ?? 80) / 2) - (modes === '' ? 0 : widthOf(modes) + 2)

      return (
        <Box flexDirection="row" gap={2}>
          {modes === '' ? null : await next(e)}
          <Text dimColor wrap="truncate-start">
            {fitPlace(where, '⎇', budget)}
          </Text>
        </Box>
      )
    }

    // The desktop flattens this slot to one line of inline text: Text and plain strings only.
    const { cost = null, cache = null } = await read($, view)
    const pieces = [cost, cache].filter((p): p is Piece => p !== null)
    if (pieces.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)

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
