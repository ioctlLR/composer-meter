import { expect, test } from 'claude-code/testing'

import { cachePiece, clock, coldWriteUsd, costPiece, enginePrice, inputPrice } from '../hooks/register'

const MIN = 60_000
const mark = { startedAt: 0, model: 'claude-opus-5-5', tokens: 200_000 }

test('cache shows its expiry time, plain until 4m left', () => {
  expect(cachePiece(mark, 5 * MIN, 30_000)).toEqual({ text: `TTL ends ${clock(5 * MIN)}`, tone: 'normal' })
  expect(cachePiece(mark, 60 * MIN, 0)?.text).toBe(`TTL ends ${clock(60 * MIN)}`)
})

test('cache warns at 4m left and is danger at 2m', () => {
  expect(cachePiece(mark, 5 * MIN, 1 * MIN)?.tone).toBe('warning')
  expect(cachePiece(mark, 5 * MIN, 3 * MIN)?.tone).toBe('error')
})

test('expired cache shows the cold write cost in danger', () => {
  // 200K tokens at $4/MTok: 5m write 1.25x = $1.00, 1h write 2x = $1.60
  expect(cachePiece(mark, 5 * MIN, 5 * MIN)).toEqual({ text: 'cold ~$1.00', tone: 'error' })
  expect(coldWriteUsd(mark, 60 * MIN).toFixed(2)).toBe('1.60')
})

test('no request yet, no cache piece', () => {
  expect(cachePiece(null, 5 * MIN, 0)).toBe(null)
})

test('model prices', () => {
  expect(inputPrice('claude-opus-5-5[1m]', 1)).toBe(4)
  expect(inputPrice('claude-opus-5', 1)).toBe(5)
  expect(inputPrice('claude-sonnet-5-5', 1)).toBe(2)
  expect(inputPrice('claude-haiku-5-5', 200_000)).toBe(0.5)
  expect(inputPrice('claude-fable-5-1', 1)).toBe(10)
})

test('session cost', () => {
  expect(costPiece({ usd: 1.234 })?.text).toBe('$1.23')
  expect(costPiece({ usd: 12.34 })?.text).toBe('$12.3')
  expect(costPiece(undefined)).toBe(null)
})

test("a model switch's estimate gives the engine's base price, its TTL divided out", () => {
  const switched = { to_model: 'claude-opus-5-5[1m]', context_tokens: 200_000, estimated_cache_write_usd: 1, pricing: 'catalog' } as const
  // $1 for 200K at 1.25x (5m) is $4/MTok; at 2x (1h) it is $2.50.
  expect(enginePrice({ ...switched, cache_ttl: '5m' })).toEqual({ model: 'claude-opus-5-5[1m]', perMTok: 4, isLong: true })
  expect(enginePrice({ ...switched, cache_ttl: '1h' })?.perMTok).toBe(2.5)
  expect(enginePrice({ ...switched, cache_ttl: '5m', pricing: 'default' })).toBe(null)
})

test("the engine's price wins for its model and tier; the table covers the rest", () => {
  const engine = { model: 'claude-opus-5-5[1m]', perMTok: 3, isLong: true }
  expect(inputPrice('claude-opus-5-5', 200_000, engine)).toBe(3)
  expect(inputPrice('claude-opus-5-5', 1_000, engine)).toBe(4)
  expect(inputPrice('claude-sonnet-5-5', 200_000, engine)).toBe(2)
  expect(cachePiece(mark, 5 * MIN, 5 * MIN, engine)?.text).toBe('cold ~$0.75')
})
