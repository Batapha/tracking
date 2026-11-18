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
  // 0.10.2：这条测试原本断言 classic.Stop 返回的 block（「still open」收尾提醒）。
  // classic.Stop 被 sec-default 跳过、已在 register.tsx 注释掉，block 不会再有，只剩「结束不响」这半条仍然成立。
  on('classic.Stop', async () => ({}))
  await $.tool.call({ tool: TOOL, id: 'a', title: 'A', stages: [{ name: 's', steps: [{ title: 'x', status: 'active' }] }] } as never)
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: '做完一半。' } as never)
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

// 0.10.2：权限框响铃原本由 classic.Notification 触发，该 hook 已被 sec-default 跳过并注释掉，此测试停用。
// 提问与提交计划两处的响铃走 AskUserQuestion / ExitPlanMode 的 tool.call，仍在（见上面两个用例）。
// test('a permission dialog the engine shows rings decision; other notifications stay silent', async ($, on) => {
//   mock.clock(on, { now: 1_000_000 })
//   mock.store(on)
//   const played = listen(on)
//   on('classic.Notification', async () => ({}))
//   await $.classic.Notification({ notification_type: 'idle_prompt', message: 'idle' } as never)
//   expect(played).toEqual([])
//   await $.classic.Notification({ notification_type: 'permission_prompt', message: 'Claude needs your permission' } as never)
//   expect(played).toEqual(['sounds/decision.wav'])
// })

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

test('a quota already alerted in store does not ring again until its reset window changes', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, {
    'quota-alerted': {
      windows: { five_hour: { at: 100, resetsAt: '2026-10-17T14:00:00Z' } },
      rungAt: 900_000,
    },
  })
  const played = listen(on)
  const toasts: string[] = []
  on('ui.toast', async (_$, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  // even more than 60s later, same resetsAt window at 100% stays silent
  await clock.advance(120_000)
  await $.session.measure({
    context: { tokens: 1000, window: 200_000 },
    changed: ['rateLimits'],
    rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: '2026-10-17T14:00:00Z' }],
  })
  expect(played).toEqual([])
  expect(toasts).toEqual([])

  // when a new 5h window starts (different resetsAt) and hits 100%, it rings once
  await $.session.measure({
    context: { tokens: 1000, window: 200_000 },
    changed: ['rateLimits'],
    rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: '2026-10-17T19:00:00Z' }],
  })
  expect(played).toEqual(['sounds/quota.wav'])
  expect(toasts).toHaveLength(1)
})

test('a ClaudeProbe session stays silent on quota', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const played = listen(on)
  // 0.10.2：探针判定改由新式 session.start 承担（register.tsx 的 session.start 里按 cwd 设 isProbeSession），
  // classic.SessionStart 已被 sec-default 跳过并注释，这里跟着换成新式事件，并补上它要用的引擎应答。
  on('session.id', async () => ({ value: 's1' }))
  on('session.usage', async () => ({
    value: {
      startedAt: 1_000_000,
      context: { tokens: 1_000, window: 200_000, percent: 1, breakdown: { autoCompactThreshold: 167_000, isAutoCompactEnabled: true } },
      rateLimits: [],
    },
  }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('tool.register', async () => ({ value: undefined }) as never)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/Users/batapha/Library/Application Support/CodexBar/ClaudeProbe', surface: 'desktop', isInteractive: true } as never)
  await $.session.measure({
    context: { tokens: 1000, window: 200_000 },
    changed: ['rateLimits'],
    rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: '2026-10-17T14:00:00Z' }],
  })
  expect(played).toEqual([])
})
