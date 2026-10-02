import { expect, test } from 'claude-code/testing'

import type { Plan, Usage } from '../types'
import { ctxLevel, renderTitle, usageCells } from '../hooks/figures'
import { costOf, modelLabel } from '../hooks/pricing'
import { shownBar } from '../hooks/bars'
import { DEFAULTS, EMPTY_USAGE } from '../hooks/state'

const cents = (n: number | null) => (n === null ? null : Math.round(n * 100))

const at = (ctxTokens: number, compactAt: number | null = 167_000): Usage => ({ ...EMPTY_USAGE, ctxTokens, ctxWindow: 200_000, compactAt })

test('ctx turns yellow 20k before auto-compact and red at it', () => {
  expect(ctxLevel({ ...EMPTY_USAGE })).toBe('off')
  expect(ctxLevel(at(100_000))).toBe('ok')
  expect(ctxLevel(at(146_999))).toBe('ok')
  expect(ctxLevel(at(147_000))).toBe('warn')
  expect(ctxLevel(at(167_000))).toBe('bad')
  // auto-compact off: only the window's last 3k is red
  expect(ctxLevel(at(196_000, null))).toBe('warn')
  expect(ctxLevel(at(197_000, null))).toBe('bad')
})

test('cost at API prices, cache writes by TTL', () => {
  const t = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }
  // Opus 5.5: 4 + 20 + 0.2 + 4 * 1.25
  expect(cents(costOf('claude-opus-5-5[1m]', t, 300_000))).toBe(cents(29.2))
  // 1h TTL writes at 2x input
  expect(cents(costOf('claude-opus-5-5', t, 3_600_000))).toBe(cents(32.2))
  expect(cents(costOf('claude-haiku-4-5-20251001', t, 300_000))).toBe(cents(7.35))
  expect(costOf('gpt-x', t, 300_000)).toBeNull()
  expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
})

test('usage cells: ctx and quota windows on one row; cost, cache and models on the other', () => {
  const now = 1_000_000
  const u: Usage = {
    ...at(120_000),
    model: 'claude-opus-5-5',
    lastResponseAt: now - 60_000,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 72, resetsAt: new Date(now + 2 * 3_600_000).toISOString() },
      { kind: 'seven_day', percentUsed: 31, resetsAt: null },
    ],
    models: {
      'claude-opus-5-5': { input: 1000, output: 2000, cacheRead: 100_000, cacheWrite: 20_000 },
      'claude-haiku-4-5': { input: 500, output: 500, cacheRead: 0, cacheWrite: 0 },
    },
  }
  const { usage, spend } = usageCells(u, DEFAULTS, now)
  expect(usage.map(c => c.key)).toEqual(['ctx', 'rl-five_hour', 'rl-seven_day'])
  expect(usage[1]?.level).toBe('warn')
  expect(usage[1]?.label).toContain('5h')
  expect(spend.map(c => c.key)).toEqual(['cost', 'cache', 'm-claude-opus-5-5', 'm-claude-haiku-4-5'])
  expect(spend[1]?.value).toBe('4:00')
    expect(spend.map(c => c.label).join(' ')).toContain('Opus 5.5')

  const hidden = usageCells(u, { ...DEFAULTS, showRateLimits: false }, now)
  expect(hidden.usage.map(c => c.key)).toEqual(['ctx'])

  const expired = usageCells(u, DEFAULTS, now + 10 * 60_000)
  expect(expired.spend[1]?.value).toBe('已失效')
})

const plan = (over: Partial<Plan>): Plan => ({
  id: 'build',
  title: '订单模块',
  kind: 'plan',
  state: 'running',
  note: null,
  startedAt: 0,
  stages: [
    { name: '设计', steps: [{ title: 'schema', status: 'done', substeps: [] }] },
    { name: '实现', steps: [{ title: 'api', status: 'active', substeps: [] }] },
  ],
  ...over,
})

test('session title from the template', () => {
  expect(renderTitle('{project} · {task}', '/Users/batapha/shop/', [])).toBe('shop')
  expect(renderTitle('{project} · {task}', '/Users/batapha/shop', [plan({})])).toBe('shop · 订单模块')
  expect(renderTitle('{project} · {task} · {stage}', '/Users/batapha/shop', [plan({})])).toBe('shop · 订单模块 · 实现')
  expect(renderTitle('{task}', '/Users/batapha/shop', [plan({ state: 'done' })])).toBe('shop')
})

test('the third row shows the latest open task, else the latest bar', () => {
  const a = plan({ id: 'a', title: 'A' })
  const b = plan({ id: 'b', title: 'B', state: 'done' })
  const c = plan({ id: 'c', title: 'C' })
  expect(shownBar([])).toBeNull()
  expect(shownBar([a, b])?.id).toBe('a')
  expect(shownBar([a, b, c])?.id).toBe('c')
  expect(shownBar([b])?.id).toBe('b')
})
