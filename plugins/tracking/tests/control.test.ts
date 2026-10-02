import { expect, mock, test } from 'claude-code/testing'

const CONTROL = 'mcp__tracking__control'
const PLAN = 'mcp__tracking__plan_progress'

test('a conversation hides and shows the band and clears the bars', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('audio.play', async () => ({ value: undefined }) as never)

  await $.tool.call({ tool: PLAN, id: 'a', title: '任务', stages: [{ name: '做', steps: [{ title: '一', status: 'active' }] }] } as never)

  const hidden = await $.tool.call({ tool: CONTROL, visible: false, clearBars: true } as never)
  expect(hidden).toMatchObject({ result: expect.stringContaining('用量条已隐藏') })
  expect(hidden).toMatchObject({ result: expect.stringContaining('进度条 0 条') })

  const shown = await $.tool.call({ tool: CONTROL, visible: true } as never)
  expect(shown).toMatchObject({ result: expect.stringContaining('用量条：显示中') })
})

test('no fields reads the state without changing it', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const state = await $.tool.call({ tool: CONTROL } as never)
  expect(state).toMatchObject({ result: expect.stringContaining('多步任务先建进度条：开') })
})

test('settings go through the settings writer under the plugin row key', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const written: [string, unknown][] = []
  on('config.list', async () => ({ value: [{ key: 'tracking@batapha-mods.planGate' }, { key: 'tracking@batapha-mods.sounds' }] }) as never)
  on('config.set', async (_$, e) => {
    written.push([e.key, e.value])
    return e.key.endsWith('.sounds') ? ({ deny: 'locked' } as never) : ({ value: e.value } as never)
  })

  const res = await $.tool.call({ tool: CONTROL, settings: { planGate: false, sounds: false, bogus: 1 } } as never)
  expect(written).toEqual([
    ['tracking@batapha-mods.sounds', false],
    ['tracking@batapha-mods.planGate', false],
  ])
  expect(res).toMatchObject({ result: expect.stringContaining('多步任务先建进度条 → 关') })
  expect(res).toMatchObject({ result: expect.stringContaining('提示音 未改：locked') })
  expect(res).toMatchObject({ result: expect.stringContaining('提示音：开') })
})
