
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
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  if (kind.startsWith('seven_day_')) return `7d ${kind.slice(10)}`
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
export function ringSvg(frac: number, level: Level, glyph?: '$' | 'clock'): string {
  const c = 2 * Math.PI * 6.5
  const len = Math.max(0, Math.min(1, frac)) * c
  const color = HEX[level]
  const inner =
    glyph === '$'
      ? `<text x="8" y="11.4" text-anchor="middle" font-size="9" font-weight="700" font-family="ui-sans-serif,system-ui,-apple-system,sans-serif" fill="${color}">$</text>`
      : glyph === 'clock'
        ? `<path d="M8 4.8V8l2 1.3" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>`
        : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="#808080" stroke-opacity=".3" stroke-width="2"/><circle cx="8" cy="8" r="6.5" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${len.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 8 8)"/>${inner}</svg>`
}

export const GLYPHS = ['○', '◔', '◑', '◕', '●']
export const glyphOf = (frac: number) => GLYPHS[Math.max(0, Math.min(4, Math.round(frac * 4)))] ?? '○'

export type Cell = { key: string; frac: number; level: Level; value: string; label: string; glyph?: '$' | 'clock' }

export function usageCells(u: Usage, opts: Options, now: number): { usage: Cell[]; spend: Cell[] } {
  const usage: Cell[] = []
  const pct = ctxPercent(u)
  const left = untilCompact(u)
  usage.push({
    key: 'ctx',
    frac: (pct ?? 0) / 100,
    level: ctxLevel(u),
    value: pct === null ? '—' : `${pct}%`,
    label: left === null ? 'ctx' : `ctx · 距压缩 ${left}%`,
  })
  // always the 5h and weekly columns, so the grid keeps its shape; a window not reported reads "—"
  for (const kind of ['five_hour', 'seven_day']) {
    const w = opts.showRateLimits ? u.rateLimits.find(r => r.kind === kind) : undefined
    if (!w) {
      usage.push({ key: `rl-${kind}`, frac: 0, level: 'off', value: '—', label: windowLabel(kind) })
      continue
    }
    const reset = w.resetsAt ? ` · ${fmtSpan(Date.parse(w.resetsAt) - now)}后重置` : ''
    usage.push({ key: `rl-${kind}`, frac: w.percentUsed / 100, level: quotaLevel(w.percentUsed), value: `${Math.round(w.percentUsed)}%`, label: `${windowLabel(kind)}${reset}` })
  }

  const spend: Cell[] = []
  const rows = Object.entries(u.models).sort((a, b) => sum(b[1]) - sum(a[1]))
  const priced = rows.map(([m, t]) => costOf(m, t, u.cacheTtlMs) ?? 0).reduce((a, b) => a + b, 0)
  const total = u.costUsd ?? (rows.length ? priced : null)
  const cache = cacheLeftMs(u, now)
  const ttlLabel = `${u.isTtlKnown ? '' : '≈'}${u.cacheTtlMs >= 3_600_000 ? '1h' : '5m'}`
  if (cache === null) {
    spend.push({ key: 'cache', frac: 0, level: 'off', value: '—', label: `缓存 ${ttlLabel}`, glyph: 'clock' })
  } else if (cache > 0) {
    spend.push({ key: 'cache', frac: cache / u.cacheTtlMs, level: cache <= 60_000 ? 'warn' : 'ok', value: fmtClock(cache), label: `缓存 ${ttlLabel}`, glyph: 'clock' })
  } else {
    const cost = u.model && u.ctxTokens ? recacheCost(u.model, u.ctxTokens, u.cacheTtlMs) : null
    spend.push({ key: 'cache', frac: 0, level: 'off', value: '已失效', label: cost === null ? '缓存' : `缓存 · 下条约多 ${fmtUsd(cost)}`, glyph: 'clock' })
  }
  spend.push({ key: 'cost', frac: 1, level: 'ok', value: total === null ? '$—' : fmtUsd(total), label: '本会话', glyph: '$' })
  // one column for the models: the largest, and how many more the details list
  const [first] = rows
  if (first) {
    const [model, t] = first
    const cost = costOf(model, t, u.cacheTtlMs)
    const more = rows.length > 1 ? ` · +${rows.length - 1} 个模型` : ''
    spend.push({ key: `m-${model}`, frac: 0, level: 'off', value: fmtTokens(sum(t)), label: `${modelLabel(model)}${cost === null ? '' : ` · ${fmtUsd(cost)}`}${more}` })
  } else {
    spend.push({ key: 'm-none', frac: 0, level: 'off', value: '—', label: '模型' })
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

// a cell: ring or glyph, the value, the label, with the gaps between them
export function cellWidth(c: Cell, isModel: boolean, isTerminal: boolean): number {
  const lead = isModel ? 0 : isTerminal ? 2 : 24
  return lead + measure(c.value, isTerminal) * (isTerminal ? 1 : 1.05) + (isTerminal ? 1 : 8) + measure(c.label, isTerminal)
}

// four columns shared by every row, as percentages of the band: each column as wide as its widest cell,
// and the room left over split evenly into the three gaps, so the cells line up down the rows and sit
// evenly across them; the last column is only as wide as its content and ends at the right edge.
export function gridColumns(rows: readonly (readonly number[])[], total: number, n = 4): string[] {
  const widest = Array.from({ length: n }, (_, i) => Math.min(total * 0.4, Math.max(0, ...rows.map(r => r[i] ?? 0))))
  const sum = widest.reduce((a, b) => a + b, 0)
  const slack = total - sum
  const widths = slack > 0 ? widest.map((w, i) => (i < n - 1 ? w + slack / (n - 1) : w)) : widest.map(w => (w / Math.max(1, sum)) * total)
  // whole percents: the surfaces take a number or an integer percentage
  const pct = widths.map(w => Math.max(1, Math.floor((w / total) * 100)))
  pct[n - 1] = Math.max(1, 100 - pct.slice(0, n - 1).reduce((a, b) => a + b, 0))
  return pct.map(p => `${p}%`)
}
