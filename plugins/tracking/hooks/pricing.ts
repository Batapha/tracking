import type { ModelTokens } from '../types'

// US dollars per million tokens, first-party API list prices (as of 2026-09-25).
// Cache writes cost 1.25x input for the 5-minute TTL and 2x for the 1-hour one.
type Price = { input: number; output: number; cacheRead: number }

// matched by prefix after normalizing the id, longest first
const PRICES: [string, Price][] = [
  ['claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['claude-mythos-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['claude-fable-5', { input: 10, output: 50, cacheRead: 1 }],
  ['claude-mythos-5', { input: 10, output: 50, cacheRead: 1 }],
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2 }],
  ['claude-opus-5', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['claude-sonnet-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['claude-sonnet-4', { input: 3, output: 15, cacheRead: 0.3 }],
  ['claude-haiku-4', { input: 1, output: 5, cacheRead: 0.1 }],
]

// "claude-opus-5-5[1m]", "us.anthropic.claude-opus-5-5", "claude-opus-4-8-20260101" -> "claude-opus-5-5" etc.
export function normalizeModel(id: string): string {
  return id
    .toLowerCase()
    .replace(/\[.*?\]/g, '')
    .replace(/^.*?(claude-)/, '$1')
    .replace(/-\d{8}$/, '')
    .replace(/@.*$/, '')
}

export function priceOf(model: string): Price | null {
  const id = normalizeModel(model)
  for (const [prefix, price] of PRICES) if (id === prefix || id.startsWith(`${prefix}-`)) return price
  return null
}

const M = 1_000_000

export function costOf(model: string, t: ModelTokens, ttlMs: number): number | null {
  const p = priceOf(model)
  if (!p) return null
  const write = p.input * (ttlMs >= 3_600_000 ? 2 : 1.25)
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * write) / M
}

// what re-sending `tokens` of context costs once the cache has expired: a fresh cache write
export function recacheCost(model: string, tokens: number, ttlMs: number): number | null {
  const p = priceOf(model)
  if (!p) return null
  return (tokens * p.input * (ttlMs >= 3_600_000 ? 2 : 1.25)) / M
}

// "claude-opus-5-5" -> "Opus 5.5", "claude-haiku-4-5" -> "Haiku 4.5"
export function modelLabel(model: string): string {
  const id = normalizeModel(model)
  const m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/)
  if (!m) return id
  const family = (m[1] ?? '').charAt(0).toUpperCase() + (m[1] ?? '').slice(1)
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}
