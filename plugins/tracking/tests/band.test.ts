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
      startedAt: NOW,
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
  on('ui.render', { component: 'AbovePromptList' }, async ($, e) => {
    const { Box } = $.ui.resolve(e)
    // core stacks the rows; a stand-in row from a test (no tree) is drawn as an empty box named after its plugin
    const tree = (r: { plugin: string; tree: RenderElement }) => (Object.keys(r.tree as object).length ? r.tree : (h(Box, { key: `row-${r.plugin}` }) as RenderElement))
    return h(Box, { key: 'engine-stack', flexDirection: 'column' }, ...e.props.rows.map(tree)) as RenderElement
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

    await $.session.measure({ context: { tokens: 101_500, window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 42 }, { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(NOW + 4 * 86_400_000 + 5 * 3_600_000).toISOString() }], changed: ['rateLimits'] })
    await clock.settle()
    const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 160 } as never
    const ui = await $.ui.mount({ plugin: 'tracking', surface, component: 'AbovePrompt', props })
    const row = await ui.find({ key: 'tracking-row' })
    expect(row).toBeDefined()
    const text = row?.text ?? ''
    // the five cells, in order: weekly, context | cache, start, cost
    const order = ['12%', '7 天 · 4d5h 后重置', '61%', '距压缩', '5:00', '缓存', '开始', '$1.23', '本会话']
    const at = order.map(x => text.indexOf(x))
    expect(at.every(i => i >= 0)).toBe(true)
    expect([...at].sort((x, y) => x - y)).toEqual(at)
    // the 5h window, the models, the status and 详情 are gone
    for (const gone of ['42%', '5 小时', 'Opus 5.5', '详情', '空闲', 'Tracking']) expect(text).not.toContain(gone)
    // the start time, in Shanghai time: 08:00Z is 16:00
    expect(text).toContain('16:00')
    // every icon names itself, so desktop draws it; nothing bold
    expect((await ui.findAll({ type: 'Svg' })).filter(x => !x.props.alt)).toHaveLength(0)
    expect((await ui.findAll({ type: 'Text' })).filter(x => x.props.bold)).toHaveLength(0)
    // no progress row any more
    expect(await ui.find({ key: 'bar-none' })).toBeUndefined()

    // a minute later the cache has a minute less, and the session has run a minute longer
    await clock.advance(60_000)
    expect((await ui.find({ key: 'tracking-row' }))?.text).toContain('4:00')

    // narrow: labels go, the weekly cell keeps its reset time
    const narrow = await $.ui.mount({ plugin: 'tracking', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 50 } as never })
    const small = (await narrow.find({ key: 'tracking-row' }))?.text ?? ''
    expect(small).toMatch(/4d\d+h/)
    expect(small).not.toContain('本会话')
    expect(small).not.toContain('距压缩')
  })

  test(`above Budget fence on ${surface}: tracking's row comes first, every row kept`, async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    answerEngine(on)
    await $.session.start({ cwd: '/Users/batapha/shop', surface, isInteractive: true })
    const fence = { plugin: 'budget-fence', tree: {} as RenderElement }
    const mine = { plugin: 'tracking', tree: {} as RenderElement }
    const other = { plugin: 'easel', tree: {} as RenderElement }
    const base = { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 20, bodyColumns: 160 }
    const ui = await $.ui.mount({ plugin: 'tracking', surface, component: 'AbovePromptList', props: { ...base, rows: [fence, other, mine] } as never })
    const stack = await ui.find({ key: 'engine-stack' })
    const keys = ((stack?.children ?? []) as { key?: string; props: Record<string, unknown> }[]).map(c => c.key ?? c.props.key)
    expect(keys).toEqual(['row-tracking', 'row-budget-fence', 'row-easel'])
    // no wrapper: the desktop would drop a wrapper's own content
    expect(await ui.find({ key: 'tracking-around-fence' })).toBeUndefined()
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

// 0.10.2：会话命名靠 classic.SessionStart / UserPromptSubmit 输出 sessionTitle，而 classic 事件已被
// cc-plugin-sec-default 截走、两个 hook 在 register.tsx 里注释掉，此用例停用。
// 恢复条件：sec-default 放行 classic.*（managed settings 的 prependPlugins），再把 hook 注释放开。
// test('the session title follows the template', { options: { titleTemplate: '{project} · {task}' } }, async ($, on) => {
//   on('classic.SessionStart', async () => ({}))
//   const result = await $.classic.SessionStart({ source: 'startup', cwd: '/Users/batapha/shop' } as never)
//   expect(result).toMatchObject({ sessionTitle: 'shop' })
// })

test('/tracking hides the row and shows it again; the terminal footer keeps its switch', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  answerEngine(on)
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { key: 'engine-modes' }) as RenderElement
  })
  await $.session.start({ cwd: '/Users/batapha/shop', surface: 'desktop', isInteractive: true })
  const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as never
  const band = await $.ui.mount({ plugin: 'tracking', surface: 'desktop', component: 'AbovePrompt', props })
  expect(await band.find({ key: 'tracking-row' })).toBeDefined()
  await $.command.run({ command: 'tracking', args: '' } as never)
  expect(await band.find({ key: 'tracking-row' })).toBeUndefined()
  await $.command.run({ command: 'tracking', args: '' } as never)
  expect(await band.find({ key: 'tracking-row' })).toBeDefined()
  const term = await $.ui.mount({ plugin: 'tracking', surface: 'terminal', component: 'SessionMode', props: { modes: [] } as never })
  expect(await term.find({ type: 'Button', text: 'Tracking' })).toBeDefined()
})
