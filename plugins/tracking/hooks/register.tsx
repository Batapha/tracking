// Tracking: a two-row usage band above the prompt (ctx, 5h, weekly, cache countdown / session cost,
// tokens per model), progress bars with sounds at each stage, and session titles.
// Everything that touches $ lives in this file; bars.ts, figures.ts and pricing.ts are pure.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, Register } from 'claude-code'

import type { AgentRun, Plan, PlanState, RateWindow, Usage } from '../types'
import { TOOL, FOLD_MS, STATE_COLOR, STATE_GLYPH, RULES, str, status, list, isFinished, normalize, parsePlan, st, DEMO, where, lastHead, visibleAgents, lastStrip, stripsHeight, stripsSvg, AGENTS, isOpenPlan, slug, placeBar, syncAuto, addRun, STEP_SCHEMA, WORK_TOOLS, WORK_BEFORE_PLAN, CALLS_BEFORE_NUDGE, SEG_H, segments, segmentsSvg, segmentsLabel } from './bars'
import type { Raw, Where } from './bars'
import { DETAIL_PANE, cacheLeftMs, windowLabel, add, detailMarkdown, ringSvg, glyphOf, usageCells, renderTitle } from './figures'
import type { Cell } from './figures'
import { DEFAULTS, EMPTY_USAGE, readOptions, THEME } from './state'
import type { Options, Sound } from './state'

// session state the drawings read; declared here so the engine's scan can follow each atom
const usage = atom({ plugin: 'tracking', key: 'usage' } as const, EMPTY_USAGE)
const tick = atom({ plugin: 'tracking', key: 'tick' } as const, 0)
const isHidden = atom({ plugin: 'tracking', key: 'isHidden' } as const, false)
const activity = atom({ plugin: 'tracking', key: 'activity' } as const, 'idle')
const alerted = atom({ plugin: 'tracking', key: 'alerted' } as const, {})
const plans = atom({ plugin: 'tracking', key: 'plans' } as const, [])
const isOpen = atom({ plugin: 'tracking', key: 'isOpen' } as const, true)
const progressTick = atom({ plugin: 'tracking', key: 'progressTick' } as const, 0)

// the person's settings, set when the module registers
let opts: Options = DEFAULTS

// macOS: the engine plays the plugin's own file with afplay; a failure stays silent
function play($: EngineInterface, name: Sound) {
  if (!opts.sounds) return
  void $.audio.play({ asset: `sounds/${name}.wav` }).catch(() => undefined)
}

function speak($: EngineInterface, text: string) {
  if (!opts.speakStages) return
  void $.audio.speak(text).catch(() => undefined)
}

// ---------- usage ----------
// ---------- bookkeeping ----------

const persist = async ($: EngineInterface, u: Usage) => {
  const id = await $.session.id()
  await $.store.set(`ledger:${id}`, { models: u.models, agents: u.agents }).catch(() => undefined)
}

async function refreshCompactAt($: EngineInterface) {
  try {
    const full = await $.session.usage({ breakdown: 'summary' })
    const b = full.context.breakdown
    if (!b) return
    await update($, usage, u => ({ ...u, compactAt: b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null }))
  } catch {
    // keep the window as the compact point
  }
}

// the transcript's last assistant row says which TTL the cache was written with
async function detectTtl($: EngineInterface, transcriptPath: string | undefined): Promise<number | null> {
  if (!transcriptPath) return null
  try {
    const { stdout } = await $.process.run(['tail', '-n', '80', transcriptPath], { timeoutMs: 3000 })
    const lines = stdout.split('\n').reverse()
    for (const line of lines) {
      if (!line.includes('ephemeral_')) continue
      const row = JSON.parse(line) as { message?: { usage?: { cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number } } } }
      const c = row.message?.usage?.cache_creation
      if (!c) continue
      if ((c.ephemeral_1h_input_tokens ?? 0) > 0) return 3_600_000
      if ((c.ephemeral_5m_input_tokens ?? 0) > 0) return 300_000
    }
  } catch {
    // no tail, or a row cut mid-line: keep what we had
  }
  return null
}

async function checkQuota($: EngineInterface, opts: Options, windows: RateWindow[]) {
  if (!opts.quotaAlerts) return
  const before = await read($, alerted)
  const next: Record<string, number> = { ...before }
  let crossed: { kind: string; at: number; pct: number } | null = null
  for (const w of windows) {
    const at = w.percentUsed >= 95 ? 95 : w.percentUsed >= 80 ? 80 : 0
    const was = before[w.kind] ?? 0
    // a window that reset starts over
    next[w.kind] = at
    if (at > was && (!crossed || at > crossed.at)) crossed = { kind: w.kind, at, pct: w.percentUsed }
  }
  await update($, alerted, () => next)
  if (crossed) {
    $.ui.toast(`${windowLabel(crossed.kind)} 额度已用 ${Math.round(crossed.pct)}%`, { timeoutMs: 8000 })
    play($, 'quota')
  }
}

// ---------- hooks ----------

// set by registerUsage; module state starts over on a reload, the figures live in $.state
let slowTick = 0

async function usageSessionStart($: EngineInterface) {
  const id = await $.session.id()
  const saved = (await $.store.get(`ledger:${id}`).catch(() => undefined)) as Pick<Usage, 'models' | 'agents'> | undefined
  const now = await $.session.usage().catch(() => null)
  const fixedTtl = opts.cacheTtl === '1h' ? 3_600_000 : opts.cacheTtl === '5m' ? 300_000 : null
  await update($, usage, u => ({
    ...EMPTY_USAGE,
    ...u,
    models: Object.keys(u.models).length ? u.models : (saved?.models ?? {}),
    agents: Object.keys(u.agents).length ? u.agents : (saved?.agents ?? {}),
    ctxWindow: now?.context.window ?? u.ctxWindow,
    ctxTokens: now?.context.tokens ?? u.ctxTokens,
    rateLimits: now ? now.rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt ?? null })) : u.rateLimits,
    costUsd: now?.cost?.usd ?? u.costUsd,
    cacheTtlMs: fixedTtl ?? u.cacheTtlMs,
    isTtlKnown: fixedTtl !== null || u.isTtlKnown,
  }))
  void refreshCompactAt($)
  await $.command.register({ name: 'tracking', description: '显示或隐藏 Tracking 用量条' })
  await $.command.register({ name: 'tracking-detail', description: '打开 Tracking 详情：各模型、各子代理的 token 和金额' })
  // a second hand while the cache counts down; otherwise every 30 s for the quota reset times
  $.clock.every(1000, async () => {
    const u = await read($, usage)
    const left = cacheLeftMs(u, await $.clock.now())
    slowTick = (slowTick + 1) % 30
    if ((left !== null && left > -2000) || slowTick === 0) await update($, tick, n => n + 1)
  })
}
async function usageStop($: EngineInterface, transcriptPath: string | undefined) {
  if (opts.cacheTtl === 'auto') {
    const ttl = await detectTtl($, transcriptPath)
    if (ttl !== null) await update($, usage, u => ({ ...u, cacheTtlMs: ttl, isTtlKnown: true }))
  }
}

async function usageTurnStart($: EngineInterface) {
  await update($, activity, () => 'running')
}

async function usageTurnComplete($: EngineInterface, agentId: string | undefined) {
  if (!agentId) await update($, activity, a => (a === 'waiting' ? a : 'idle'))
}

function registerUsage(on: On, options: Options) {
  opts = options
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const used = result.usage
    if (!used) return result
    const model = used.model || e.model
    const at = await $.clock.now()
    let agentTitle = ''
    if (e.agentId && !(await read($, usage)).agents[e.agentId]) {
      const agentId = e.agentId
      agentTitle = (await $.agent.list().catch(() => [])).find(a => a.id === agentId)?.description ?? ''
    }
    const u = await update($, usage, u => {
      const models = { ...u.models, [model]: add(u.models[model], used.input_tokens, used.output_tokens, used.cache_read_input_tokens, used.cache_creation_input_tokens) }
      if (e.agentId) {
        const prev = u.agents[e.agentId]
        const tokens = (prev?.tokens ?? 0) + used.input_tokens + used.output_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens
        return { ...u, models, agents: { ...u.agents, [e.agentId]: { title: prev?.title || agentTitle || e.agentId.slice(0, 8), model, tokens } } }
      }
      const isNewModel = u.model !== null && u.model !== model
      return {
        ...u,
        models,
        model,
        ctxTokens: used.input_tokens + used.cache_read_input_tokens + used.cache_creation_input_tokens,
        lastResponseAt: at,
        compactAt: isNewModel ? null : u.compactAt,
      }
    })
    if (!e.agentId && u.compactAt === null) void refreshCompactAt($)
    await persist($, u)
    return result
  })

  on('session.measure', async ($, e, next) => {
    const windows = e.rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt ?? null }))
    await update($, usage, u => ({
      ...u,
      ctxWindow: e.context.window || u.ctxWindow,
      // a compaction empties the live window until the next response
      ctxTokens: e.changed.includes('context') ? (e.context.tokens ?? null) : u.ctxTokens,
      rateLimits: e.changed.includes('rateLimits') || u.rateLimits.length === 0 ? windows : u.rateLimits,
      costUsd: e.cost?.usd ?? u.costUsd,
    }))
    if (e.changed.includes('rateLimits')) await checkQuota($, opts, windows)
    return next(e)
  })

  on('command.run', { command: 'tracking' }, async $ => {
    const hidden = await read($, isHidden)
    await update($, isHidden, () => !hidden)
    return { text: hidden ? 'Tracking 已显示。' : 'Tracking 已隐藏，再次输入 /tracking 可显示。' }
  })

  on('command.run', { command: 'tracking-detail' }, async $ => {
    const opened = await $.ui.open({ id: DETAIL_PANE, title: 'Tracking 详情' })
    return { text: opened.isPlaced ? 'Tracking 详情已打开。' : '终端太窄，详情面板暂时放不下。' }
  })

  on('ui.render', { component: 'Pane', requestId: DETAIL_PANE }, async ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    await read($, tick)
    return <Markdown text={detailMarkdown(await read($, usage), await $.clock.now())} />
  })

}

async function drawUsage($: EngineInterface, e: { surface: string }, opts: Options, elements: ReturnType<EngineInterface['ui']['resolve']>) {
  if (await read($, isHidden)) return null
  await read($, tick)
  const u = await read($, usage)
  const busy = await read($, activity)
  const { usage: top, spend } = usageCells(u, opts, await $.clock.now())
  const { Box, Text, Button } = elements
  const isTerminal = e.surface === 'terminal'
  // the terminal's table has Svg but draws it blank: glyphs there
  const Svg = !isTerminal && 'Svg' in elements ? elements.Svg : null

  const cell = (c: Cell, isModel: boolean) => (
    <Box key={c.key} flexDirection="row" alignItems="center" gap={1}>
      {isModel ? null : Svg ? (
        <Svg source={ringSvg(c.frac, c.level, c.glyph)} alt={`${c.label} ${c.value}`} width={16} height={16} />
      ) : (
        <Text color={THEME[c.level]}>{c.glyph === '$' ? '$' : glyphOf(c.frac)}</Text>
      )}
      <Text bold={!isModel} color={isModel ? undefined : c.level === 'off' ? undefined : THEME[c.level]} dimColor={c.level === 'off' && !isModel}>
        {c.value}
      </Text>
      <Text dimColor wrap="truncate">
        {c.label}
      </Text>
    </Box>
  )
  const dotColor = busy === 'waiting' ? THEME.warn : busy === 'running' ? THEME.ok : THEME.off
  const dotLabel = busy === 'waiting' ? '等你' : busy === 'running' ? '运行中' : '空闲'

  return (
    <Box key="tracking-usage" flexDirection="column" alignItems="center">
      <Box flexDirection="row" alignItems="center" justifyContent="center" columnGap={isTerminal ? 3 : 4} flexWrap="wrap">
        <Text color={dotColor}>{`● ${dotLabel}`}</Text>
        {top.map(c => cell(c, false))}
      </Box>
      <Box flexDirection="row" alignItems="center" justifyContent="center" columnGap={isTerminal ? 3 : 4} flexWrap="wrap">
        {spend.map(c => cell(c, c.key.startsWith('m-')))}
        <Button key="tracking-detail" plain dimColor label="详情" onPress={() => $.ui.open({ id: DETAIL_PANE, title: 'Tracking 详情' })} />
        <Button key="tracking-hide" plain dimColor label="✕" onPress={() => update($, isHidden, () => true)} />
      </Box>
    </Box>
  )
}

// ---------- progress bars ----------

// ---------- engine glue ----------


function chime($: EngineInterface, prev: PlanState | undefined, next: PlanState) {
  if (next === prev) return
  if (next === 'needs_input') {
    play($, 'decision')
    void update($, activity, () => 'waiting')
  }
  if (next === 'error') play($, 'error')
  if (next === 'done') play($, 'done')
}

async function putPlan($: EngineInterface, next: Plan) {
  let prev: Plan | undefined
  await update($, plans, list => {
    prev = list.find(p => p.id === next.id)
    return placeBar(list, next)
  })
  chime($, prev?.state, next.state)
  // a finished stage plays no sound (too frequent); it is spoken only when the person turned that on
  if (prev && next.state === 'running' && next.stages.length > 1) {
    const before = where(prev).stage
    if (where(next).stage > before) speak($, `${prev.stages[before]?.name ?? ''} 完成`)
  }
  if (!prev) await update($, isOpen, () => true)
}

// ---------- agents: drawn from engine events alone, no model calls ----------
// each subagent lives on a bar as one state strip: the open task bar it was started under,
// the bar of its parent agent, or the mod's own "Agents" bar when no task is open.
// Module maps: a reload forgets running agents, whose strips then stay until the bar is closed.
const agentHome = new Map<string, string>() // agentId -> bar id
const toolUses = new Map<string, string>() // tool_use_id -> agentId, to find who waits on a permission
const waiting = new Set<string>()
let foldUntil = 0 // keep ticking until finished strips have folded

// changes one agent's strip inside the latest list; sounds follow the bar's state
async function editAgent($: EngineInterface, agentId: string, change: (a: AgentRun) => AgentRun) {
  const home = agentHome.get(agentId)
  if (!home) return
  const now = await $.clock.now()
  let before: PlanState | undefined
  let after: PlanState | undefined
  let isFolding = false
  await update($, plans, list =>
    list.map(p => {
      if (p.id !== home || !p.agents?.some(a => a.id === agentId)) return p
      before = p.state
      const next = syncAuto({ ...p, agents: p.agents.map(a => (a.id === agentId ? change(a) : a)) }, now)
      after = next.state
      isFolding = !p.agentsDoneAt && next.agentsDoneAt !== null
      return next
    }),
  )
  if (isFolding) foldUntil = now + FOLD_MS + 1500
  if (before !== undefined && after !== undefined) chime($, before, after)
}

async function dropPlan($: EngineInterface, id: string) {
  lastHead.delete(id)
  for (const p of await read($, plans)) if (p.id === id) for (const a of p.agents ?? []) lastStrip.delete(a.id)
  await update($, plans, list => list.filter(p => p.id !== id))
}

function registerProgress(on: On, options: Options) {
  opts = options
  // main-loop calls in flight, so a permission prompt on one marks the session as waiting
  const mainCalls = new Set<string>()
  // per-turn bookkeeping; module variables are fine here, a reload just starts a fresh count
  let workCalls = 0
  let sinceUpdate = 0
  let isPlanTouched = false
  let hasRefused = false
  let isWaitingOnBackground = false

  on('turn.start', async ($, e, next) => {
    workCalls = 0
    sinceUpdate = 0
    isPlanTouched = false
    hasRefused = false
    isWaitingOnBackground = false
    await usageTurnStart($)

    return next(e)
  })

  // the rule lives in the cached system prompt; a message only carries one short line when bars are open,
  // and the person answering clears any "needs input" without a model call
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') return next(e)
    await update($, activity, () => 'running')
    const list = await read($, plans)
    if (list.some(p => p.state === 'needs_input')) {
      await update($, plans, all => all.map(p => (p.state === 'needs_input' ? { ...p, state: 'running' as const, note: null } : p)))
    }
    const open = list.filter(p => p.state !== 'done' && p.id !== AGENTS)
    if (open.length === 0) return next(e)
    const line = `tracking open bars: ${open
      .map(p => {
        const w = where(p)
        return `${p.id} (${p.stages[w.stage]?.name ?? ''} ${w.step}/${w.stageSize})`
      })
      .join(', ')}`

    return next({ ...e, context: [...(e.context ?? []), line] })
  })

  // watches the main loop's changing calls: refuses once when multi-step work starts without a bar,
  // and reminds to update the bar when it goes stale mid-turn
  on('tool.call', async ($, e, next) => {
    // a subagent's call only names its current tool on its strip; no gate, no reminders
    if (e.agentId) {
      const agentId = e.agentId
      if (!agentHome.has(agentId)) return next(e)
      await editAgent($, agentId, a => ({ ...a, state: 'running', tool: e.tool }))
      if (e.tool_use_id) toolUses.set(e.tool_use_id, agentId)
      const ran = await next(e)
      if (e.tool_use_id) toolUses.delete(e.tool_use_id)
      if (waiting.delete(agentId)) await editAgent($, agentId, a => (a.state === 'waiting' ? { ...a, state: 'running' } : a))
      return ran
    }
    const gate = async () => {
      if (!WORK_TOOLS.has(e.tool)) return next(e)
      isWaitingOnBackground = (e as unknown as Raw).run_in_background === true
      const hasLivePlan = isPlanTouched || (await read($, plans)).some(isOpenPlan)
      if (opts.planGate && !hasLivePlan && !hasRefused && workCalls >= WORK_BEFORE_PLAN) {
        hasRefused = true

        return { deny: `tracking: several changes ahead. Create a bar with ${TOOL} first, then retry.` }
      }
      const ran = await next(e)
      // a shell call that only read (ls, git status, grep) is not work
      if (ran.deny !== undefined || ran.isReadOnly) return ran
      workCalls += 1
      sinceUpdate += 1
      if (hasLivePlan && sinceUpdate >= CALLS_BEFORE_NUDGE) {
        sinceUpdate = 0

        return { ...ran, context: [...(ran.context ?? []), `tracking: bar is stale, send {id, next:true} or {id, done, active}.`] }
      }

      return ran
    }
    if (e.tool_use_id) mainCalls.add(e.tool_use_id)
    try {
      return await gate()
    } finally {
      if (e.tool_use_id && mainCalls.delete(e.tool_use_id) && (await read($, activity)) === 'waiting') await update($, activity, () => 'running')
    }
  })

  // an open bar at the end of a turn: a question to the user marks it waiting on its own;
  // only a turn that did work and left the bar unexplained is sent back once
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    await usageStop($, e.transcript_path)
    if (e.stop_hook_active || result.block || isWaitingOnBackground || (e.background_tasks?.length ?? 0) > 0) return result
    // a turn that ends on a question waits on the person, bar or no bar
    const asks = /[?？]\s*$/.test(e.last_assistant_message ?? '')
    const open = (await read($, plans)).filter(isOpenPlan)
    if (asks && open.length === 0) {
      await update($, activity, () => 'waiting')
      play($, 'decision')
      return result
    }
    if (open.length === 0) return result
    if (asks) {
      const last = open[open.length - 1]
      if (last) await putPlan($, { ...last, state: 'needs_input' })

      return result
    }
    if (workCalls === 0 && !isPlanTouched) return result

    return {
      ...result,
      block: `tracking: ${open.map(p => p.id).join(', ')} still open. Update each with ${TOOL}: {id, next:true}, or state "done", "needs_input" or "error" with a note.`,
    }
  })

  on('session.start', async ($, e, next) => {
    await usageSessionStart($)
    await $.tool.register({
      name: 'plan_progress',
      description: 'Live progress bar above the prompt, one per id. Create with title + stages; update with short ops (next, done, active, failed) or state.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Bar id; reuse it for updates' },
          title: { type: 'string' },
          kind: { enum: ['plan', 'todo'] },
          stages: {
            type: 'array',
            description: 'Full breakdown, only when creating or restructuring',
            items: { type: 'object', required: ['name', 'steps'], properties: { name: { type: 'string' }, steps: { type: 'array', items: STEP_SCHEMA } } },
          },
          next: { type: 'boolean', description: 'Active step finished, start the next one' },
          done: { type: 'array', items: { type: 'string' }, description: 'Step titles now finished' },
          active: { type: 'string', description: 'Step title now in progress' },
          failed: { type: 'string', description: 'Step title that failed' },
          state: { enum: ['running', 'needs_input', 'error', 'done'] },
          note: { type: 'string', description: 'One line for needs_input or error' },
        },
      },
    })
    $.clock.every(1000, async () => {
      if (agentHome.size > 0 || (await $.clock.now()) < foldUntil) await update($, progressTick, n => n + 1)
    })
    await $.command.register({ name: 'tracking-demo', description: '显示一条示例进度条' })
    await $.command.register({ name: 'tracking-sounds', description: '试听提示音：等你决定、出错、完成、限额' })
    await $.command.register({ name: 'tracking-clear', description: '清掉所有进度条' })

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)

    return { sections: [...result.sections, { id: 'tracking:rules', text: RULES, scope: 'session' as const }] }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const raw = e as unknown as Raw
    const now = await $.clock.now()
    const list = await read($, plans)
    const id = slug(str(raw.id, 60) || str(raw.title, 80))
    const next = normalize(raw, list.find(p => p.id === id) ?? null, now, id)
    if (next.stages.length === 0) return { deny: `plan_progress: no bar "${id}" yet; create it with title and stages.` }
    isPlanTouched = true
    sinceUpdate = 0
    await putPlan($, next)
    const w = where(next)

    const active = next.stages.flatMap(st => st.steps).find(st => st.status === 'active')

    return { result: `${id}: ${Math.min(w.pos, w.total)}/${w.total}, ${next.state}${active ? `, active "${active.title}"` : ''}` }
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const live = (await read($, plans)).filter(p => p.state === 'running').pop()
    if (live) await update($, plans, list => list.map(p => (p.id === live.id ? { ...p, state: 'needs_input' as const } : p)))
    play($, 'decision')
    await update($, activity, () => 'waiting')
    const ran = await next(e)
    if (live) await update($, plans, list => list.map(p => (p.id === live.id && p.state === 'needs_input' ? { ...p, state: 'running' as const } : p)))

    return ran
  })

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    play($, 'decision')
    const ran = await next(e)
    const text = ran.deny === undefined && ran.isError !== true ? (ran.result as { plan?: unknown } | undefined)?.plan : undefined
    if (typeof text === 'string') {
      const parsed = parsePlan(text, await $.clock.now())
      if (parsed) await putPlan($, { ...parsed, id: slug(parsed.title) })
    }

    return ran
  })

  on('command.run', { command: 'tracking-demo' }, async $ => {
    await putPlan($, DEMO(await $.clock.now()))
    await update($, isOpen, () => true)
    await update($, isHidden, () => false)

    return { text: '示例进度条已显示在输入框上方，/tracking-clear 可清除。' }
  })

  on('command.run', { command: 'tracking-clear' }, async $ => {
    await update($, plans, () => [])

    return { text: '进度条已清除。' }
  })

  on('command.run', { command: 'tracking-sounds' }, async $ => {
    const order: Sound[] = ['decision', 'error', 'done', 'quota']
    order.forEach((name, i) => (i === 0 ? play($, name) : $.clock.after(i * 1100, () => play($, name))))
    if (!opts.sounds) return { text: '提示音已在设置里关闭（/plugin → tracking → 配置 → 提示音）。' }

    return { text: '依次播放：需要你决定、出错、任务完成、额度告警。' }
  })

  // always drawn, so the person sees the mod is loaded; it shows and hides the whole Tracking band
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const hidden = await read($, isHidden)
    const { Box, Button } = $.ui.resolve(e)
    // other mods add their labels to modes beneath us; keep them
    const below = await next(e)

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Button key="tracking-toggle" dimColor={hidden} label="Tracking" onPress={() => update($, isHidden, () => !hidden)} />
        {below}
      </Box>
    )
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (!('agentId' in started) || !started.agentId) return started
    const id = started.agentId
    const now = await $.clock.now()
    const parentHome = e.parentAgentId ? agentHome.get(e.parentAgentId) : undefined
    const home = parentHome ?? [...(await read($, plans))].reverse().find(isOpenPlan)?.id ?? AGENTS
    agentHome.set(id, home)
    const run: AgentRun = {
      id,
      title: (e.description || e.subagentType).slice(0, 60),
      state: 'running',
      tool: '启动中',
      startedAt: now,
      endedAt: null,
      depth: parentHome ? 1 : 0,
    }
    let isNew = false
    await update($, plans, list => {
      if (list.some(p => p.id === home)) return list.map(p => (p.id === home ? addRun(p, run, e.parentAgentId, now) : p))
      isNew = true
      const auto: Plan = { id: AGENTS, title: '子代理', kind: 'todo', stages: [], state: 'running', note: null, startedAt: now }
      return placeBar(list, addRun(auto, run, undefined, now))
    })
    if (isNew) await update($, isOpen, () => true)

    return started
  })

  // an agent waiting on a permission prompt turns its strip amber until the call goes on
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    // the main loop held on a permission prompt: the session waits on the person
    const mainId = e.tool_use_id
    if (mainId && mainCalls.has(mainId) && verdict.decision === 'ask') {
      $.clock.after(600, async () => {
        if (!mainCalls.has(mainId)) return
        await update($, activity, () => 'waiting')
        play($, 'decision')
      })
    }
    const agentId = e.tool_use_id ? toolUses.get(e.tool_use_id) : undefined
    const useId = e.tool_use_id
    // the mode often settles an ask by itself in a blink; only a call still held after a moment waits on the person
    if (agentId && useId && verdict.decision === 'ask') {
      $.clock.after(600, async () => {
        if (toolUses.get(useId) !== agentId) return
        waiting.add(agentId)
        await editAgent($, agentId, a => ({ ...a, state: 'waiting', tool: '等待批准' }))
      })
    }

    return verdict
  })

  on('turn.complete', async ($, e, next) => {
    await usageTurnComplete($, e.agentId)
    const agentId = e.agentId
    if (agentId && agentHome.has(agentId)) {
      const now = await $.clock.now()
      const isFailed = e.reason !== 'answer'
      const tool = e.reason === 'aborted' ? '已停止' : isFailed ? '失败' : '完成'
      await editAgent($, agentId, a => ({ ...a, state: isFailed ? 'error' : 'done', tool, endedAt: now }))
      // the mod's own bar sounds through its state; a strip on a task bar sounds here
      if (isFailed && agentHome.get(agentId) !== AGENTS) play($, 'error')
      agentHome.delete(agentId)
      waiting.delete(agentId)
    }
    // a plan whose steps are all finished closes itself
    for (const p of await read($, plans)) {
      if (p.id === AGENTS) continue
      if (p.state === 'done') continue
      const steps = p.stages.flatMap(s => s.steps)
      if (steps.length > 0 && steps.every(s => isFinished(s.status))) await putPlan($, { ...p, state: 'done' })
    }

    return next(e)
  })
}

// the bars under the usage rows; null when there is nothing to show
async function drawProgress($: EngineInterface, surface: string, bodyColumns: number, t: ReturnType<EngineInterface['ui']['resolve']>) {
  const list = await read($, plans)
  if (list.length === 0 || !(await read($, isOpen))) return null
  const { Box, Button, Text } = t
  const Svg = surface !== 'terminal' && 'Svg' in t ? t.Svg : null
  // desktop reports ~8 CSS px per column; the steps take at most half the band
  const maxW = Math.max(160, Math.round((bodyColumns || 100) * 8 * 0.5))
  await read($, progressTick)
  const now = await $.clock.now()

  return (
    <Box flexDirection="column" alignItems="center" gap={1}>
      {list.map(p => {
        const v = visibleAgents(p, now)
        const w = where(p)
        const pct = p.state === 'done' ? 100 : Math.round((Math.min(w.pos, w.total) / Math.max(1, w.total)) * 100)
        const color = STATE_COLOR[p.state]
        const label = segmentsLabel(p)
        const seg = segmentsSvg(p, maxW)
        const alt = `${p.title}: ${label}, ${pct}%${p.note ? ` — ${p.note}` : ''}`
        const stripsH = v ? stripsHeight(v.shown.length + (v.hidden.length > 0 ? 1 : 0)) : 0
        const stripsW = Math.max(seg.width, 240)

        return (
          <Box key={`bar-${p.id}`} flexDirection="column" alignItems="center">
            <Box flexDirection="row" alignItems="center" justifyContent="center" gap={1}>
              <Text color={color}>{STATE_GLYPH[p.state]}</Text>
              <Text wrap="truncate">{p.title}</Text>
              {Svg ? (
                <Svg source={seg.source} alt={alt} width={seg.width} height={SEG_H} />
              ) : (
                <Text>
                  {segments(p).map((stage, i) => (
                    <Text key={`stage-${i}`}>
                      {i > 0 ? ' ' : ''}
                      {stage.map((x, j) => (
                        <Text key={`step-${i}-${j}`} color={x === 'done' ? THEME.ok : x === 'error' ? THEME.bad : undefined} dimColor={x === 'todo'}>
                          ▬
                        </Text>
                      ))}
                    </Text>
                  ))}
                </Text>
              )}
              <Text color={p.state === 'done' ? THEME.ok : color}>{label}</Text>
              <Text dimColor>{`${pct}%`}</Text>
              <Button key={`close-${p.id}`} plain dimColor label="✕" onPress={() => dropPlan($, p.id)} />
            </Box>
            {v && Svg ? <Svg source={`<svg xmlns="http://www.w3.org/2000/svg" width="${stripsW}" height="${stripsH}">${stripsSvg(v, stripsW, now)}</svg>`} alt={`agents: ${(p.agents ?? []).map(a => `${a.title} ${a.state}`).join(', ')}`} width={stripsW} height={stripsH} /> : null}
          </Box>
        )
      })}
    </Box>
  )
}

// ---------- session title and the band ----------

async function sessionTitleFor($: EngineInterface, opts: Options, cwd: string): Promise<string | undefined> {
  if (!opts.renameSession) return undefined
  const t = renderTitle(opts.titleTemplate, cwd, await read($, plans))
  return t || undefined
}

export const register: Register = (on, options) => {
  opts = readOptions(options)
  registerUsage(on, opts)
  registerProgress(on, opts)

  // one band: the usage rows, then the progress bars
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const t = $.ui.resolve(e)
    const top = await drawUsage($, e, opts, t)
    const bars = (await read($, isHidden)) ? null : await drawProgress($, e.surface, e.props.bodyColumns, t)
    if (!top && !bars) return next(e)
    const { Box } = t

    return (
      <Box flexDirection="column" alignItems="center" gap={1}>
        {top}
        {bars}
      </Box>
    )
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    const sessionTitle = await sessionTitleFor($, opts, e.cwd)
    return sessionTitle && !result.sessionTitle ? { ...result, sessionTitle } : result
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    const sessionTitle = await sessionTitleFor($, opts, e.cwd)
    return sessionTitle && !result.sessionTitle ? { ...result, sessionTitle } : result
  })
}
