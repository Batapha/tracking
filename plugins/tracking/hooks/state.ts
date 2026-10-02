import type { Usage } from '../types'

export const EMPTY_USAGE: Usage = {
  ctxTokens: null,
  ctxWindow: 0,
  compactAt: null,
  model: null,
  rateLimits: [],
  costUsd: null,
  lastResponseAt: null,
  cacheTtlMs: 5 * 60_000,
  isTtlKnown: false,
  models: {},
  agents: {},
}


export type Options = {
  cacheTtl: 'auto' | '5m' | '1h'
  showRateLimits: boolean
  quotaAlerts: boolean
  sounds: boolean
  speakStages: boolean
  renameSession: boolean
  titleTemplate: string
  planGate: boolean
}

export const DEFAULTS: Options = {
  cacheTtl: 'auto',
  showRateLimits: true,
  quotaAlerts: true,
  sounds: true,
  speakStages: false,
  renameSession: true,
  titleTemplate: '{project} · {task}',
  planGate: true,
}

export function readOptions(raw: unknown): Options {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = <K extends keyof Options>(k: K, ok: (v: unknown) => boolean): Options[K] => (ok(o[k]) ? (o[k] as Options[K]) : DEFAULTS[k])
  const isBool = (v: unknown) => typeof v === 'boolean'
  return {
    cacheTtl: pick('cacheTtl', v => v === 'auto' || v === '5m' || v === '1h'),
    showRateLimits: pick('showRateLimits', isBool),
    quotaAlerts: pick('quotaAlerts', isBool),
    sounds: pick('sounds', isBool),
    speakStages: pick('speakStages', isBool),
    renameSession: pick('renameSession', isBool),
    titleTemplate: pick('titleTemplate', v => typeof v === 'string' && v.trim() !== ''),
    planGate: pick('planGate', isBool),
  }
}

export type Sound = 'decision' | 'error' | 'done' | 'quota'

// green / yellow / red, as the theme names them on the terminal and as hex where an Svg draws
export type Level = 'ok' | 'warn' | 'bad' | 'off'
export const THEME: Record<Level, string> = { ok: 'success', warn: 'warning', bad: 'error', off: 'inactive' }
export const HEX: Record<Level, string> = { ok: '#30A46C', warn: '#E09A1E', bad: '#E5484D', off: '#8A8984' }
