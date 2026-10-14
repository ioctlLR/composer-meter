import type { CacheMark } from '../types'

// A resumed conversation's cache is as old as its last main-thread request. The transcript
// file is the only place a mod can read when that was: `$.session.messages()` carries no
// timestamps.

type Entry = {
  type?: unknown
  isSidechain?: unknown
  timestamp?: unknown
  message?: { model?: unknown; usage?: Record<string, unknown> }
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

// The last main-thread response with usage, dated from when its request was sent: the
// main-thread `user` entry (prompt or tool result) written just before it, else the
// response's own timestamp. Sidechain lines and lines that do not parse are skipped.
export function lastRequestIn(jsonl: string): CacheMark | null {
  let sentAt: number | null = null
  let last: CacheMark | null = null

  for (const line of jsonl.split('\n')) {
    if (!line.includes('"user"') && !line.includes('"assistant"')) continue

    let entry: Entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.isSidechain === true) continue

    const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
    if (Number.isNaN(at)) continue

    if (entry.type === 'user') {
      sentAt = at
      continue
    }
    if (entry.type !== 'assistant') continue

    const usage = entry.message?.usage
    const model = entry.message?.model
    // Claude Code writes `<synthetic>` replies of its own, with no request behind them.
    if (!usage || typeof model !== 'string' || model === '' || model.startsWith('<')) continue

    const tokens =
      count(usage.input_tokens) +
      count(usage.cache_read_input_tokens) +
      count(usage.cache_creation_input_tokens) +
      count(usage.output_tokens)
    if (tokens > 0) last = { startedAt: sentAt ?? at, model, tokens }
  }

  return last
}
