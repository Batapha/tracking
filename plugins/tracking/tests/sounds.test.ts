import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const TOOL = 'mcp__tracking__plan_progress'

const listen = (on: On) => {
  const played: string[] = []
  on('audio.play', async (_$, e) => {
    played.push(e.clip.asset ?? '')
    return { value: undefined } as never
  })
  return played
}

test('a finished or failed bar stays silent', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const played = listen(on)
  await $.tool.call({ tool: TOOL, id: 'a', title: 'A', stages: [{ name: 's', steps: [{ title: 'x', status: 'active' }] }] } as never)
  await $.tool.call({ tool: TOOL, id: 'a', state: 'done' } as never)
  await $.tool.call({ tool: TOOL, id: 'b', title: 'B', stages: [{ name: 's', steps: [{ title: 'x', status: 'active' }] }] } as never)
  await $.tool.call({ tool: TOOL, id: 'b', state: 'error', note: 'boom' } as never)
  expect(played).toEqual([])
})

test('a turn that ends is silent, whether or not it ends on a question', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const played = listen(on)
  on('classic.Stop', async () => ({}))
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: '改好了。' } as never)
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: '要继续吗？' } as never)
  expect(played).toEqual([])
})

test('a turn ending on a question with a bar open turns it amber but stays silent', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const played = listen(on)
  on('classic.Stop', async () => ({}))
  await $.tool.call({ tool: TOOL, id: 'a', title: 'A', stages: [{ name: 's', steps: [{ title: 'x', status: 'active' }] }] } as never)
  const first = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: '做完一半。' } as never)
  expect(first).toMatchObject({ block: expect.stringContaining('still open') })
  await $.classic.Stop({ stop_hook_active: true, last_assistant_message: '先这样，要继续吗？' } as never)
  expect(played).toEqual([])
})

test('Claude setting a bar to wait on the person rings decision once', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const played = listen(on)
  await $.tool.call({ tool: TOOL, id: 'a', title: 'A', stages: [{ name: 's', steps: [{ title: 'x', status: 'active' }] }] } as never)
  await $.tool.call({ tool: TOOL, id: 'a', state: 'needs_input', note: '选哪个' } as never)
  expect(played).toEqual(['sounds/decision.wav'])
})

test('a permission dialog the engine shows rings decision; other notifications stay silent', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const played = listen(on)
  on('classic.Notification', async () => ({}))
  await $.classic.Notification({ notification_type: 'idle_prompt', message: 'idle' } as never)
  expect(played).toEqual([])
  await $.classic.Notification({ notification_type: 'permission_prompt', message: 'Claude needs your permission' } as never)
  expect(played).toEqual(['sounds/decision.wav'])
})

test('two asks within five seconds ring once', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const played = listen(on)
  on('tool.call', { tool: 'AskUserQuestion' }, async () => ({ result: { answers: {} } }) as never)
  await $.tool.call({ tool: TOOL, id: 'a', title: 'A', stages: [{ name: 's', steps: [{ title: 'x', status: 'active' }] }] } as never)
  await $.tool.call({ tool: TOOL, id: 'a', state: 'needs_input', note: '选哪个' } as never)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  expect(played).toEqual(['sounds/decision.wav'])
})

test('a quota rings only once it has run out', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const played = listen(on)
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  on('classic.StopFailure', async () => ({}))
  const measure = (pct: number) =>
    $.session.measure({ context: { tokens: 1000, window: 200_000 }, changed: ['rateLimits'], rateLimits: [{ kind: 'five_hour', percentUsed: pct }] })
  await measure(82)
  await measure(96)
  expect(played).toEqual([])
  await measure(100)
  expect(played).toEqual(['sounds/quota.wav'])
  // the refused request right after is the same event: no second ring
  await $.classic.StopFailure({ error: 'rate_limit' } as never)
  expect(played).toEqual(['sounds/quota.wav'])
  expect(toasts.length).toBe(3)
})
