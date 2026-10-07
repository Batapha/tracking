import { expect, test } from 'claude-code/testing'

import type { AgentRun, Plan, Usage } from '../types'
import { agentRuns, agentsCell, sessionTotal, bandLayout, columnContent, ctxLevel, detailMarkdown, renderTitle, usageCells } from '../hooks/figures'
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

test('usage cells: ctx and quota windows on one row; cache first, then cost and models on the other', () => {
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
  expect(usage[1]?.label).toContain('5 小时 · 2h 后重置')
  expect(usage[0]?.label).toContain('上下文 · 距压缩')
  expect(spend.map(c => c.key)).toEqual(['cache', 'cost', 'm-claude-opus-5-5'])
  expect(spend[2]?.label).toContain('+1 个模型')
  // the model's cost leads, like the session cost beside it
  expect(spend[2]?.value).toMatch(/^\$/)
  expect(spend.map(c => c.icon)).toEqual(['clock', 'coin', 'cube'])
  expect(spend[0]?.value).toBe('4:00')
    expect(spend.map(c => c.label).join(' ')).toContain('Opus 5.5')

  const hidden = usageCells(u, { ...DEFAULTS, showRateLimits: false }, now)
  // the columns stay, with nothing in them
  expect(hidden.usage.map(c => c.key)).toEqual(['ctx', 'rl-five_hour', 'rl-seven_day'])
  expect(hidden.usage[1]?.value).toBe('—')

  const expired = usageCells(u, DEFAULTS, now + 10 * 60_000)
  expect(expired.spend[0]?.value).toBe('已失效')
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

test('band layout: each group as wide as its widest value and label, the room left split evenly, all in whole percents', () => {
  // groups 27, 31, 25, 12 cells (icon 2 + value + gap 1 + label, or icon + a wider spanning cell); +3 each for the rule
  const layout = bandLayout(
    [
      { value: 4, label: 20, wide: 10 },
      { value: 6, label: 22, wide: 0 },
      { value: 6, label: 16, wide: 0 },
      { value: 5, label: 4, wide: 6 },
    ],
    120,
  )
  expect(layout.map(c => c.width)).toEqual(['27%', '31%', '26%', '16%'])
  expect(layout[0]).toMatchObject({ group: '88%', icon: '7%', value: '15%' })
  // never edge to edge: room on both sides of every group
  for (const c of layout) expect(parseInt(c.group)).toBeLessThanOrEqual(88)
  for (const c of layout) for (const v of [c.width, c.group, c.icon, c.value]) expect(v).toMatch(/^\d+%$/)
  // too wide for the band: columns shrink in proportion and a group never exceeds its column
  const tight = bandLayout([{ value: 6, label: 40, wide: 0 }, { value: 6, label: 40, wide: 0 }, { value: 6, label: 40, wide: 0 }, { value: 5, label: 4, wide: 6 }], 80)
  expect(tight.reduce((a, c) => a + parseInt(c.width), 0)).toBe(100)
  for (const c of tight) expect(parseInt(c.group)).toBeLessThanOrEqual(88)
  // cells count CJK as two
  expect(columnContent(['$2.41'], ['Opus 5.5 · 3.8M', '本会话'])).toEqual({ value: 6, label: 15, wide: 0 })
})

test('running subagents turn the 详情 cell into a count and lead the detail pane', () => {
  const run = (id: string, state: AgentRun['state'], startedAt: number): AgentRun => ({ id, title: id, state, tool: 'Read', startedAt, endedAt: state === 'done' ? startedAt + 30_000 : null, depth: 0 })
  const plan: Plan = { id: 'p', title: '复核', kind: 'plan', stages: [], state: 'running', note: null, startedAt: 0, agents: [run('旧的', 'done', 0), run('第1轮独立复核', 'running', 1000)] }
  const runs = agentRuns([plan])
  expect(runs[0]?.title).toBe('第1轮独立复核')
  expect(agentsCell(runs)).toEqual({ label: '子代理 1 ›', live: 1, isWaiting: false })
  expect(agentsCell([run('a', 'done', 0)]).label).toBe('详情 ›')
  expect(agentsCell([run('a', 'waiting', 0)]).isWaiting).toBe(true)
  const md = detailMarkdown({ ...EMPTY_USAGE }, 135_000, runs)
  expect(md.startsWith('**子代理**（1 个在运行）')).toBe(true)
  expect(md).toContain('| 第1轮独立复核 | 运行中 | Read | 2m 14s |')
  expect(md).toContain('| 旧的 | 完成 | — | 30s |')
})

test('the session total never lags the per-response ledger', () => {
  const models = { 'claude-opus-5-5': { input: 0, output: 100_000, cacheRead: 0, cacheWrite: 0 } }
  const ledger = sessionTotal({ ...EMPTY_USAGE, models }).priced
  expect(ledger).toBeGreaterThan(1)
  // /cost reported after the first response only: the ledger wins
  expect(sessionTotal({ ...EMPTY_USAGE, models, costUsd: 0.31 }).total).toBe(ledger)
  // /cost knows of more than the ledger saw: /cost wins
  expect(sessionTotal({ ...EMPTY_USAGE, models, costUsd: 99 }).total).toBe(99)
  expect(sessionTotal({ ...EMPTY_USAGE }).total).toBe(null)
  expect(usageCells({ ...EMPTY_USAGE, models, costUsd: 0.31 }, DEFAULTS, 0).spend.find(c => c.key === 'cost')?.value).not.toBe('$0.31')
})

test('the context share counts toward auto-compact, so used and left add up to 100', () => {
  // 1M window, auto-compact at 770k, 760k in use: 99% used, 1% left (not 76% and 1%)
  const u: Usage = { ...EMPTY_USAGE, ctxTokens: 760_000, ctxWindow: 1_000_000, compactAt: 770_000 }
  const [ctx] = usageCells(u, DEFAULTS, 0).usage
  expect(ctx?.value).toBe('99%')
  expect(ctx?.label).toBe('上下文 · 距压缩 1%')
  expect(ctx?.frac).toBe(0.99)
  // auto-compact off or not known yet: the window
  const [off] = usageCells({ ...u, compactAt: null }, DEFAULTS, 0).usage
  expect(off?.value).toBe('76%')
  expect(off?.label).toBe('上下文')
})
