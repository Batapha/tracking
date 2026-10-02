import type { Options } from './state'

// lets a conversation drive the band: show or hide it, clear bars, open details, change settings
export const CONTROL_NAME = 'control'
export const CONTROL = `mcp__tracking__${CONTROL_NAME}`

export type SettingKey = keyof Options

export const SETTING_LABELS: Record<SettingKey, string> = {
  cacheTtl: '提示缓存有效期',
  showRateLimits: '显示 5h / 周限额',
  quotaAlerts: '限额提醒',
  sounds: '提示音',
  speakStages: '朗读阶段',
  renameSession: '自动命名会话',
  titleTemplate: '会话标题模板',
  planGate: '多步任务先建进度条',
}

const BOOL = { type: 'boolean' }

export const CONTROL_SPEC = {
  name: CONTROL_NAME,
  description:
    'Controls the Tracking band above the prompt (usage, cache countdown, cost, step progress). ' +
    'Call it when the person asks in words to show or hide the band, clear progress bars, open the details pane, ' +
    'or turn a Tracking setting on or off (sounds, quota alerts, 5h/7d limits, plan gate, session naming). ' +
    'Call with no fields to read the current state. Settings persist like /plugin → tracking → 配置.',
  inputSchema: {
    type: 'object',
    properties: {
      visible: { type: 'boolean', description: 'true shows the whole band, false hides it (same as /tracking)' },
      clearBars: { type: 'boolean', description: 'true removes every progress bar' },
      openDetail: { type: 'boolean', description: 'true opens the per-model / per-subagent details pane' },
      settings: {
        type: 'object',
        description: 'Tracking settings to change; leave out the ones that stay',
        properties: {
          showRateLimits: BOOL,
          quotaAlerts: BOOL,
          sounds: BOOL,
          speakStages: BOOL,
          renameSession: BOOL,
          planGate: { type: 'boolean', description: 'false stops the one-time refusal that asks for a progress bar before multi-step work' },
          cacheTtl: { enum: ['auto', '5m', '1h'] },
          titleTemplate: { type: 'string', description: '{project}, {task}, {stage} placeholders' },
        },
      },
    },
  },
}

export type ControlInput = {
  visible?: boolean
  clearBars?: boolean
  openDetail?: boolean
  settings: Partial<Options>
}

// keeps only fields of the right type; anything else is dropped rather than passed to the settings writer
export function readControl(raw: unknown): ControlInput {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const flag = (v: unknown) => (typeof v === 'boolean' ? v : undefined)
  const s = (o.settings && typeof o.settings === 'object' ? o.settings : {}) as Record<string, unknown>
  const settings: Partial<Options> = {}
  for (const k of ['showRateLimits', 'quotaAlerts', 'sounds', 'speakStages', 'renameSession', 'planGate'] as const) {
    if (typeof s[k] === 'boolean') settings[k] = s[k] as boolean
  }
  if (s.cacheTtl === 'auto' || s.cacheTtl === '5m' || s.cacheTtl === '1h') settings.cacheTtl = s.cacheTtl
  if (typeof s.titleTemplate === 'string' && s.titleTemplate.trim() !== '') settings.titleTemplate = s.titleTemplate
  return { visible: flag(o.visible), clearBars: flag(o.clearBars), openDetail: flag(o.openDetail), settings }
}

// a settings row's key is `<plugin>.<field>`; the plugin part may carry its marketplace
export function settingRowKey(rows: readonly { key: string }[], field: SettingKey): string {
  const row = rows.find(r => r.key === `tracking.${field}` || (r.key.startsWith('tracking@') && r.key.endsWith(`.${field}`)))
  return row ? row.key : `tracking.${field}`
}

const show = (v: unknown) => (typeof v === 'boolean' ? (v ? '开' : '关') : String(v))

export function statusText(opts: Options, isBandHidden: boolean, barCount: number): string {
  const lines = [`用量条：${isBandHidden ? '已隐藏' : '显示中'}；进度条 ${barCount} 条`]
  for (const k of Object.keys(SETTING_LABELS) as SettingKey[]) lines.push(`${SETTING_LABELS[k]}：${show(opts[k])}`)
  return lines.join('\n')
}

export function settingLine(field: SettingKey, value: unknown, deny?: string): string {
  return deny ? `${SETTING_LABELS[field]} 未改：${deny}` : `${SETTING_LABELS[field]} → ${show(value)}`
}
