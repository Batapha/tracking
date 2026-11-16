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

