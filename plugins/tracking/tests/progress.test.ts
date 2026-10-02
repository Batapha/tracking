import type { RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const TOOL = 'mcp__tracking__plan_progress'

test('finishing a stage plays no sound and the session is renamed', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const played: string[] = []
  on('audio.play', async (_$, e) => {
    played.push(e.clip.asset ?? '')
    return { value: undefined } as never
  })
  on('classic.UserPromptSubmit', async () => ({}))

  const create = await $.tool.call({
    tool: TOOL,
    id: 'orders',
    title: '订单模块',
    stages: [
      { name: '设计', steps: [{ title: '表结构', status: 'active' }] },
      { name: '实现', steps: [{ title: '接口', status: 'pending' }] },
    ],
  } as never)
  expect(create).toMatchObject({ result: expect.stringContaining('orders: 0/2') })
  expect(played).toEqual([])

  await $.tool.call({ tool: TOOL, id: 'orders', next: true } as never)
  expect(played).toEqual([])

  const titled = await $.classic.UserPromptSubmit({ prompt: '继续', cwd: '/Users/batapha/shop' } as never)
  expect(titled).toMatchObject({ sessionTitle: 'shop · 订单模块' })
})

for (const sounds of [true, false]) {
  test(`asking the person ${sounds ? 'rings' : 'stays silent with sounds off'}`, { options: { sounds } }, async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    const played: string[] = []
    on('audio.play', async (_$, e) => {
      played.push(e.clip.asset ?? '')
      return { value: undefined } as never
    })
    on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ result: 'A' }))
    await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
    expect(played).toEqual(sounds ? ['sounds/decision.wav'] : [])
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the bar shows one short segment per step on ${surface}`, async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    on('audio.play', async () => ({ value: undefined }) as never)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Box } = $.ui.resolve(e)
      return h(Box, { key: 'engine-band' }) as RenderElement
    })
    await $.tool.call({
      tool: TOOL,
      id: 'orders',
      title: '订单模块',
      stages: [
        { name: '设计', steps: [{ title: 'a', status: 'done' }, { title: 'b', status: 'done' }] },
        { name: '实现', steps: [{ title: 'c', status: 'active' }, { title: 'd', status: 'pending' }] },
      ],
    } as never)
    const ui = await $.ui.mount({ plugin: 'tracking', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 120 } as never })
    const bar = await ui.find({ key: 'bar-orders' })
    expect(bar?.text).toContain('实现 · 2/4')
    expect(bar?.text).toContain('50%')
    const svg = (await ui.findAll({ type: 'Svg' })).find(x => String(x.props.alt).startsWith('订单模块'))
    if (svg) {
      const source = String(svg.props.source)
      expect(source.match(/<rect/g)).toHaveLength(4)
      expect(source.match(/#30A46C/g)).toHaveLength(2)
    } else {
      expect(surface).toBe('terminal')
      expect(bar?.text).toContain('▬▬ ▬▬')
    }
  })
}
