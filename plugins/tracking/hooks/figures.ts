
import type { ModelTokens, Plan, RateWindow, Usage } from '../types'
import { costOf, modelLabel, recacheCost } from './pricing'
import { HEX } from './state'
import type { Level, Options } from './state'

export const DETAIL_PANE = 'tracking-detail'

// ---------- figures ----------

export const sum = (t: ModelTokens) => t.input + t.output + t.cacheRead + t.cacheWrite

// Claude Code's own context indicator (2.1.287): warn within 20k tokens of the auto-compact
// point, red once there or within 3k of the window. Tracking keeps those thresholds in green/yellow/red.
export function ctxLevel(u: Usage): Level {
  if (u.ctxTokens === null || u.ctxWindow <= 0) return 'off'
  const compactAt = u.compactAt ?? u.ctxWindow
  if (u.ctxTokens >= compactAt || u.ctxTokens >= u.ctxWindow - 3000) return 'bad'
  if (u.ctxTokens >= compactAt - 20_000) return 'warn'
  return 'ok'
}

export function ctxPercent(u: Usage): number | null {
  if (u.ctxTokens === null || u.ctxWindow <= 0) return null
  return Math.min(100, Math.round((u.ctxTokens / u.ctxWindow) * 100))
}

// share left before auto-compact, as the engine's "N% until auto-compact" counts it
export function untilCompact(u: Usage): number | null {
  if (u.ctxTokens === null || u.compactAt === null || u.compactAt <= 0) return null
  return Math.max(0, Math.round(((u.compactAt - u.ctxTokens) / u.compactAt) * 100))
}

export const quotaLevel = (pct: number): Level => (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok')

export function cacheLeftMs(u: Usage, now: number): number | null {
  if (u.lastResponseAt === null) return null
  return u.cacheTtlMs - (now - u.lastResponseAt)
}

export function fmtTokens(n: number): string {
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(n >= 9_950_000 ? 0 : 1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function fmtUsd(n: number): string {
  return n >= 100 ? `$${n.toFixed(0)}` : n >= 0.995 ? `$${n.toFixed(2)}` : `$${n.toFixed(n >= 0.0995 ? 2 : 3)}`
}

export function fmtSpan(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return h ? `${d}d${h}h` : `${d}d`
  if (h > 0) return m ? `${h}h${m}m` : `${h}h`
  return `${m}m`
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function windowLabel(kind: string): string {
  if (kind === 'five_hour') return '5 小时'
  if (kind === 'seven_day') return '7 天'
  if (kind.startsWith('seven_day_')) return `7 天 ${kind.slice(10)}`
  if (kind === 'spend_limit') return '额度'
  return kind
}

export const add = (a: ModelTokens | undefined, input: number, output: number, cacheRead: number, cacheWrite: number): ModelTokens => ({
  input: (a?.input ?? 0) + input,
  output: (a?.output ?? 0) + output,
  cacheRead: (a?.cacheRead ?? 0) + cacheRead,
  cacheWrite: (a?.cacheWrite ?? 0) + cacheWrite,
})


// ---------- drawing ----------

export function detailMarkdown(u: Usage, now: number): string {
  const lines: string[] = []
  const pct = ctxPercent(u)
  const left = untilCompact(u)
  lines.push('**上下文**')
  lines.push('')
  lines.push(
    u.ctxTokens === null
      ? '还没有模型回复。'
      : pct === null
        ? `${fmtTokens(u.ctxTokens)} tokens（窗口大小未知）`
        : `${fmtTokens(u.ctxTokens)} / ${fmtTokens(u.ctxWindow)} tokens（${pct}%）${left !== null ? `，距自动压缩 ${left}%` : ''}`,
  )
  const cache = cacheLeftMs(u, now)
  if (cache !== null) {
    const ttl = u.cacheTtlMs >= 3_600_000 ? '1h' : '5m'
    lines.push('')
    lines.push(cache > 0 ? `缓存还剩 ${fmtClock(cache)}（TTL ${ttl}${u.isTtlKnown ? '' : '，推测'}）` : `缓存已失效（TTL ${ttl}）`)
  }
  lines.push('')
  lines.push('**各模型消耗**（主对话 + 子代理，按 API 标价折算）')
  lines.push('')
  const rows = Object.entries(u.models).sort((a, b) => sum(b[1]) - sum(a[1]))
  if (rows.length === 0) {
    lines.push('暂无。')
  } else {
    lines.push('| 模型 | 输入 | 输出 | 缓存读 | 缓存写 | 合计 | 金额 |')
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
    for (const [model, t] of rows) {
      const cost = costOf(model, t, u.cacheTtlMs)
      lines.push(`| ${modelLabel(model)} | ${fmtTokens(t.input)} | ${fmtTokens(t.output)} | ${fmtTokens(t.cacheRead)} | ${fmtTokens(t.cacheWrite)} | ${fmtTokens(sum(t))} | ${cost === null ? '—' : fmtUsd(cost)} |`)
    }
  }
  if (u.costUsd !== null) {
    lines.push('')
    lines.push(`本会话总额 ${fmtUsd(u.costUsd)}（与 /cost 一致）。`)
  }
  const agents = Object.values(u.agents).sort((a, b) => b.tokens - a.tokens)
  if (agents.length > 0) {
    lines.push('')
    lines.push('**子代理**')
    lines.push('')
    lines.push('| 子代理 | 模型 | tokens |')
    lines.push('| --- | --- | ---: |')
    for (const a of agents.slice(0, 20)) lines.push(`| ${a.title.replace(/\|/g, '/')} | ${modelLabel(a.model)} | ${fmtTokens(a.tokens)} |`)
  }
  if (u.rateLimits.length > 0) {
    lines.push('')
    lines.push('**额度**')
    lines.push('')
    for (const w of u.rateLimits) {
      const reset = w.resetsAt ? `，${fmtSpan(Date.parse(w.resetsAt) - now)} 后重置` : ''
      lines.push(`- ${windowLabel(w.kind)}：已用 ${Math.round(w.percentUsed)}%${reset}`)
    }
  }
  return lines.join('\n')
}

// one ring like the built-in usage meter: a grey track and the used share in its level's colour
export function ringSvg(frac: number, level: Level): string {
  const c = 2 * Math.PI * 6
  const len = Math.max(0, Math.min(1, frac)) * c
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="#808080" stroke-opacity=".3" stroke-width="2"/><circle cx="8" cy="8" r="6" fill="none" stroke="${HEX[level]}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${len.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 8 8)"/></svg>`
}

// every cell leads with one icon in a fixed slot: a ring that fills, or a plain grey outline
export type Icon = 'ring' | 'clock' | 'coin' | 'cube' | 'info' | 'steps'
const OUTLINE: Record<Exclude<Icon, 'ring'>, string> = {
  clock: '<circle cx="8" cy="8.6" r="5.6"/><path d="M8 5.8v3l2 1.3M6.3 2.2h3.4"/>',
  coin: '<circle cx="8" cy="8" r="6.2"/><path d="M10 6c-.4-.7-1.1-.9-2-.9-1.1 0-1.9.6-1.9 1.4 0 2 4 1 4 3 0 .9-.9 1.5-2.1 1.5-.9 0-1.7-.3-2.1-1M8 4v1.1M8 10.9V12"/>',
  cube: '<path d="M8 1.8 13.6 5v6L8 14.2 2.4 11V5z"/>',
  info: '<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4M8 4.8v.1"/>',
  steps: '<path d="M2.4 12.6h3.4V9.2h3.4V5.8h4.4"/>',
}
export function iconSvg(icon: Exclude<Icon, 'ring'>): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#8A8984" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${OUTLINE[icon]}</svg>`
}
// the terminal draws no Svg: one narrow glyph per icon
export const ICON_GLYPH: Record<Exclude<Icon, 'ring'>, string> = { clock: '◷', coin: '$', cube: '◆', info: '≡', steps: '▸' }
export function dotSvg(level: Level): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="${HEX[level]}"/></svg>`
}

export const GLYPHS = ['○', '◔', '◑', '◕', '●']
export const glyphOf = (frac: number) => GLYPHS[Math.max(0, Math.min(4, Math.round(frac * 4)))] ?? '○'

// one grid cell: icon, then the value (white, or yellow / red at a warning), then the grey label
export type Cell = { key: string; icon: Icon; frac: number; level: Level; value: string; label: string }

export function usageCells(u: Usage, opts: Options, now: number): { usage: Cell[]; spend: Cell[] } {
  const usage: Cell[] = []
  const pct = ctxPercent(u)
  const left = untilCompact(u)
  usage.push({
    key: 'ctx',
    icon: 'ring',
    frac: (pct ?? 0) / 100,
    level: ctxLevel(u),
    value: pct === null ? '—' : `${pct}%`,
    label: left === null ? '上下文' : `上下文 · 距压缩 ${left}%`,
  })
  // always the 5h and weekly columns, so the grid keeps its shape; a window not reported reads "—"
  for (const kind of ['five_hour', 'seven_day']) {
    const w = opts.showRateLimits ? u.rateLimits.find(r => r.kind === kind) : undefined
    if (!w) {
      usage.push({ key: `rl-${kind}`, icon: 'ring', frac: 0, level: 'off', value: '—', label: windowLabel(kind) })
      continue
    }
    const reset = w.resetsAt ? ` · ${fmtSpan(Date.parse(w.resetsAt) - now)} 后重置` : ''
    usage.push({ key: `rl-${kind}`, icon: 'ring', frac: w.percentUsed / 100, level: quotaLevel(w.percentUsed), value: `${Math.round(w.percentUsed)}%`, label: `${windowLabel(kind)}${reset}` })
  }

  const spend: Cell[] = []
  const rows = Object.entries(u.models).sort((a, b) => sum(b[1]) - sum(a[1]))
  const priced = rows.map(([m, t]) => costOf(m, t, u.cacheTtlMs) ?? 0).reduce((a, b) => a + b, 0)
  const total = u.costUsd ?? (rows.length ? priced : null)
  const cache = cacheLeftMs(u, now)
  const ttlLabel = `${u.isTtlKnown ? '' : '≈'}${u.cacheTtlMs >= 3_600_000 ? '1h' : '5m'}`
  if (cache === null) {
    spend.push({ key: 'cache', icon: 'clock', frac: 0, level: 'off', value: '—', label: `缓存 · ${ttlLabel}` })
  } else if (cache > 0) {
    spend.push({ key: 'cache', icon: 'clock', frac: cache / u.cacheTtlMs, level: cache <= 60_000 ? 'warn' : 'ok', value: fmtClock(cache), label: `缓存 · ${ttlLabel}` })
  } else {
    const cost = u.model && u.ctxTokens ? recacheCost(u.model, u.ctxTokens, u.cacheTtlMs) : null
    spend.push({ key: 'cache', icon: 'clock', frac: 0, level: 'bad', value: '已失效', label: cost === null ? '缓存' : `缓存 · 下条约多 ${fmtUsd(cost)}` })
  }
  spend.push({ key: 'cost', icon: 'coin', frac: 1, level: 'ok', value: total === null ? '$—' : fmtUsd(total), label: '本会话' })
  // one column for the models: the largest, and how many more the details list
  const [first] = rows
  if (first) {
    const [model, t] = first
    const cost = costOf(model, t, u.cacheTtlMs)
    const more = rows.length > 1 ? ` · +${rows.length - 1} 个模型` : ''
    // the cost first, like the session's cell beside it; the tokens go in the label
    spend.push({
      key: `m-${model}`,
      icon: 'cube',
      frac: 0,
      level: 'ok',
      value: cost === null ? fmtTokens(sum(t)) : fmtUsd(cost),
      label: `${modelLabel(model)}${cost === null ? '' : ` · ${fmtTokens(sum(t))}`}${more}`,
    })
  } else {
    spend.push({ key: 'm-none', icon: 'cube', frac: 0, level: 'off', value: '—', label: '模型' })
  }
  return { usage, spend }
}

// the grid's first two rows, three cells each before the fourth column: usage (ctx, 5h, weekly) and spend (cache, session cost, models)

// ---------- session title ----------

export const SEPARATORS = /^[\s·|:,\-–—/]+|[\s·|:,\-–—/]+$/g

// "{project} · {task}" with the folder name, the open bar's title and its current stage;
// a part with nothing to say drops out together with its separator
export function renderTitle(template: string, cwd: string, list: readonly Plan[]): string {
  const project = cwd.replace(/\/+$/, '').split('/').pop() ?? ''
  const bar = [...list].reverse().find(p => p.state !== 'done' && !p.id.includes(':')) ?? null
  const steps = bar ? bar.stages.flatMap((s, i) => s.steps.map(step => ({ i, step }))) : []
  const current = steps.find(x => x.step.status !== 'done' && x.step.status !== 'skipped')
  const stage = bar && current ? (bar.stages[current.i]?.name ?? '') : ''
  const values: Record<string, string> = { project, task: bar?.title ?? '', stage }
  const parts = template.split(/(\{[a-z]+\})/)
  let out = ''
  let pendingSep = ''
  for (const part of parts) {
    const m = part.match(/^\{([a-z]+)\}$/)
    if (m) {
      const value = values[m[1] ?? ''] ?? ''
      if (value) {
        out += (out ? pendingSep : '') + value
        pendingSep = ''
      }
    } else {
      pendingSep += part
    }
  }
  if (!out) return project
  return out.replace(SEPARATORS, '').slice(0, 80)
}

// ---------- the band's grid ----------

// how wide a string draws: terminal cells (CJK two), or desktop CSS px at the band's ~13 px font
export function measure(s: string, isTerminal: boolean): number {
  return [...s].reduce((w, ch) => {
    const wide = /[⺀-鿿豈-﫿＀-￯]/.test(ch)
    if (isTerminal) return w + (wide ? 2 : 1)
    return w + (wide ? 13 : /[ilI.,:;'|!·]/.test(ch) ? 3.6 : 7.2)
  }, 0)
}

// ---------- the band's layout ----------
// Every width is an integer percent: the surfaces lay a Box's number out in units that differ (terminal cells,
// desktop pixels), but a percent of its parent means the same on both. Sizes are worked out in terminal cells
// (CJK two, the rest one), which on desktop, ~8 px a cell at a 13 px font, errs a little wide, never narrow.

// one column's content, in cells: its widest value, its widest label, and its widest cell that spans both
export type ColumnContent = { value: number; label: number; wide: number }
// one column as drawn: its share of the band, its group's share of the column, and the icon's and value's shares of the group
export type ColumnLayout = { width: string; group: string; icon: string; value: string }

export const ICON_CELLS = 2 // the icon and the gap after it
const GAP = 1 // between the value and the label
const RULE = 3 // the vertical rule and the padding either side
const GROUP_MAX = 88 // percent of its column a group may take

export const cells = (s: string) => Math.ceil(measure(s, true))

export function columnContent(values: readonly string[], labels: readonly string[], wide: readonly number[] = []): ColumnContent {
  return {
    value: Math.max(3, ...values.map(cells)) + 1,
    label: Math.max(2, ...labels.map(cells)),
    wide: Math.max(0, ...wide),
  }
}

// each column's group is icon · value · label, as wide as its widest; the room left over is split evenly across all
// four columns, so every group sits in the middle of its column with the same space around it
export function bandLayout(content: readonly ColumnContent[], total: number): ColumnLayout[] {
  const cap = Math.max(12, Math.floor(total * 0.4))
  const groups = content.map(c => Math.min(cap, Math.max(ICON_CELLS + c.value + GAP + c.label, ICON_CELLS + c.wide)))
  const needed = groups.map(g => g + RULE)
  const sum = needed.reduce((a, b) => a + b, 0)
  const slack = total - sum
  const widths = slack > 0 ? needed.map(w => w + slack / content.length) : needed.map(w => (w / sum) * total)
  const pct = widths.map(w => Math.max(1, Math.floor((w / total) * 100)))
  pct[pct.length - 1] = Math.max(1, 100 - pct.slice(0, -1).reduce((a, b) => a + b, 0))
  const share = (part: number, whole: number) => `${Math.max(1, Math.min(100, Math.round((part / Math.max(1, whole)) * 100)))}%`
  // a group never fills its column: at least 6% clear on each side, so the icon keeps off the rule before it
  return content.map((c, i) => {
    const g = groups[i] ?? 1
    const column = ((pct[i] ?? 25) / 100) * total - RULE
    const group = `${Math.min(GROUP_MAX, parseInt(share(g, column)))}%`
    return { width: `${pct[i]}%`, group, icon: share(ICON_CELLS, g), value: share(c.value, g) }
  })
}
