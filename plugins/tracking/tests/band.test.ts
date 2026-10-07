import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop'] as const
const NOW = Date.parse('2026-10-02T08:00:00Z')

const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3 }
const USED = { input_tokens: 2_000, output_tokens: 1_500, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 8_000, model: 'claude-opus-5-5' }

// what a session's engine would answer beneath the plugin
function answerEngine(on: On) {
  on('session.id', async () => ({ value: 's1' }))
  on('session.usage', async () => ({
    value: {
      context: { tokens: 100_000, window: 200_000, percent: 50, breakdown: { autoCompactThreshold: 167_000, isAutoCompactEnabled: true } },
      rateLimits: [],
    },
  }) as never)
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async () => ({ value: undefined }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  // the engine's own band: nothing
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'engine-band' }) as RenderElement
  })
}

for (const surface of SURFACES) {
  test(`two rows above the prompt on ${surface}: usage, then spend`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    answerEngine(on)
    on('turn.step', async function* () {
      return { turnId: 't1', index: 0, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: USED }
    })

    await $.session.start({ cwd: '/Users/batapha/shop', surface, isInteractive: true })
    const stream = $.turn.step(STEP)
    for await (const _ of stream) void _
    await $.session.measure({
      context: { tokens: 101_500, window: 200_000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 42, resetsAt: new Date(NOW + 3 * 3_600_000).toISOString() },
        { kind: 'seven_day', percentUsed: 12 },
      ],
      cost: { usd: 1.23 },
      changed: ['context', 'rateLimits', 'cost'],
    })
    await clock.settle()

    const ui = await $.ui.mount({
      plugin: 'tracking',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as never,
    })
    const band = await ui.find({ key: 'tracking-usage' })
    expect(band).toBeDefined()
    // a grid: usage row, a hairline, spend row, then the progress row; four equal columns each
    const row = async (key: string) => ((await ui.find({ key }))?.children ?? []) as { props: Record<string, unknown>; children: unknown[] }[]
    const widths = (await row('row-usage')).map(c => c.props.width)
    expect(widths).toHaveLength(4)
    expect(Math.round(widths.reduce((a: number, w) => a + parseFloat(String(w)), 0))).toBe(100)
    for (const key of ['row-usage', 'row-spend', 'bar-none']) {
      const cols = await row(key)
      // the same columns on every row, so the cells line up
      expect(cols.map(c => c.props.width)).toEqual(widths)
    }
    // every cell is icon · value · label; a column's value slot is one width on every row, so the values centre on one line
    type Node = { key?: string; props: Record<string, unknown>; children: unknown[] }
    const slotIn = (n: Node, key: string): Node | undefined => {
      if (n.key === key || n.props.key === key) return n
      for (const c of n.children ?? []) {
        if (c && typeof c === 'object' && 'props' in c) {
          const hit = slotIn(c as Node, key)
          if (hit) return hit
        }
      }
      return undefined
    }
    for (const col of [0, 1, 2]) {
      const ws = await Promise.all(['row-usage', 'row-spend'].map(async k => slotIn((await row(k))[col] as Node, 'value')?.props.width))
      expect(ws[0]).toMatch(/^\d+%$/)
      expect(ws[1]).toBe(ws[0])
    }
    // and each column's group is one width on every row, centred in the column
    for (const col of [0, 1, 2, 3]) {
      const cellBoxes = await Promise.all(['row-usage', 'row-spend', 'bar-none'].map(async k => slotIn((await row(k))[col] as Node, 'cell')))
      expect(cellBoxes.every(b => b?.props.justifyContent === 'center')).toBe(true)
      const groups = cellBoxes.map(b => ((b?.children ?? [])[0] as Node | undefined)?.props.width)
      expect(groups[0]).toMatch(/^\d+%$/)
      expect(new Set(groups).size).toBe(1)
    }
    // the status and 详情 have no value: they span the value and label slots, centred
    for (const k of ['row-usage', 'row-spend']) expect(slotIn((await row(k))[3] as Node, 'wide')).toBeDefined()
    // every icon names itself, so desktop draws it
    expect((await ui.findAll({ type: 'Svg' })).filter(x => !x.props.alt)).toHaveLength(0)
    expect((await ui.find({ key: 'row-usage' }))?.text).toMatch(/空闲$/)
    expect((await ui.find({ key: 'row-spend' }))?.text).toMatch(/详情 ›$/)
    // one weight everywhere: nothing bold
    expect((await ui.findAll({ type: 'Text' })).filter(x => x.props.bold)).toHaveLength(0)
    // and a second hairline above the progress row, each exactly the band's width: never cut short with "…"
    if (surface === 'terminal') {
      const rules = await ui.findAll({ type: 'Text', text: /^─+$/ })
      expect(rules.map(r => r.text.length)).toEqual([120, 120])
    } else {
      const rules = (await ui.findAll({ type: 'Svg' })).filter(r => r.props.alt === '分隔线')
      expect(rules).toHaveLength(2)
      // wider than the band (120 columns ≈ 960 px), clipped by its full-width box
      expect(rules[0]?.props.width).toBeGreaterThan(960)
      const boxes = (await ui.findAll({ type: 'Box' })).filter(b => b.props.overflow === 'hidden' && b.props.width === '100%')
      expect(boxes).toHaveLength(2)
    }

    const text = band?.text ?? ''
    expect(text).toContain('61%') // ctx: 101.5k of the 167k auto-compact point
    expect(text).toContain('距压缩')
    expect(text).toContain('42%') // 5h
    expect(text).toContain('5 小时')
    expect(text).toContain('7 天')
    expect(text).toContain('5:00') // cache, just written
    expect(text).toContain('$1.23')
    expect(text).toContain('Opus 5.5')

    // a minute later the cache has a minute less
    await clock.advance(60_000)
    expect((await ui.find({ key: 'tracking-usage' }))?.text).toContain('4:00')

    // the band has no close button; the progress row is there before any task
    expect(await ui.find({ type: 'Button', text: '✕' })).toBeUndefined()
    expect((await ui.find({ key: 'bar-none' }))?.text).toContain('暂无进行中的任务')
  })
}

test('the ledger keeps tokens per model and per subagent', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  answerEngine(on)
  on('agent.list', async () => ({ value: [{ id: 'a1', description: '查日志' }] }) as never)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USED, model: e.model } }
  })
  for (const step of [STEP, { ...STEP, index: 1 }, { ...STEP, model: 'claude-haiku-4-5', agentId: 'a1' }]) {
    for await (const _ of $.turn.step(step)) void _
  }
  const ui = await $.ui.mount({ plugin: 'tracking', surface: 'terminal', component: 'Pane', requestId: 'tracking-detail', props: {} as never })
  const md = (await ui.find({ type: 'Markdown' }))?.text ?? ''
  expect(md).toContain('Opus 5.5')
  expect(md).toContain('Haiku 4.5')
  expect(md).toContain('查日志')
})

test('the session title follows the template', { options: { titleTemplate: '{project} · {task}' } }, async ($, on) => {
  on('classic.SessionStart', async () => ({}))
  const result = await $.classic.SessionStart({ source: 'startup', cwd: '/Users/batapha/shop' } as never)
  expect(result).toMatchObject({ sessionTitle: 'shop' })
})
