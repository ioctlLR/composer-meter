import { expect, test } from 'claude-code/testing'

import { cachePiece, clock, coldWriteUsd, costPiece, inputPrice } from '../hooks/register'

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
