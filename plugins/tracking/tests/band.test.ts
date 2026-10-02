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
    const rows = (band?.children ?? []).filter(c => typeof c === 'object')
    expect(rows).toHaveLength(2)

    const text = band?.text ?? ''
    expect(text).toContain('51%') // ctx
    expect(text).toContain('距压缩')
    expect(text).toContain('42%') // 5h
    expect(text).toContain('5h')
    expect(text).toContain('7d')
    expect(text).toContain('5:00') // cache, just written
    expect(text).toContain('$1.23')
    expect(text).toContain('Opus 5.5')

    // a minute later the cache has a minute less
    await clock.advance(60_000)
    expect((await ui.find({ key: 'tracking-usage' }))?.text).toContain('4:00')

    // ✕ hides the band
    await ui.press({ key: 'tracking-hide' })
    expect(await ui.find({ key: 'tracking-usage' })).toBeUndefined()
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
