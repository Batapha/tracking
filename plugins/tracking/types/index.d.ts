// ---------- usage band ----------

// token counts as the API reports them, summed per model
export type ModelTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type RateWindow = {
  kind: string
  percentUsed: number
  resetsAt: string | null
}

export type Usage = {
  // input side of the main thread's last response (uncached + cache read + cache write)
  ctxTokens: number | null
  ctxWindow: number
  // token count where auto-compact runs; null when it is off or unknown
  compactAt: number | null
  model: string | null
  rateLimits: RateWindow[]
  // the engine's own ledger, as /cost totals it
  costUsd: number | null
  // when the main thread's last response arrived, for the cache countdown
  lastResponseAt: number | null
  cacheTtlMs: number
  // whether the TTL was read off the transcript or is still the default
  isTtlKnown: boolean
  models: Record<string, ModelTokens>
  // per subagent: model and tokens, for the details pane
  agents: Record<string, { title: string; model: string; tokens: number }>
}

// ---------- progress bars (adapted from plan-progress, MIT) ----------

export type StepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'
export type PlanSubstep = { title: string; status: StepStatus }
export type PlanStep = { title: string; status: StepStatus; substeps: PlanSubstep[] }
export type PlanStage = { name: string; steps: PlanStep[] }
export type PlanState = 'running' | 'needs_input' | 'error' | 'done'
export type AgentRun = {
  id: string
  title: string
  state: 'running' | 'waiting' | 'done' | 'error'
  tool: string
  startedAt: number
  endedAt: number | null
  depth: number
}
export type Plan = {
  id: string
  title: string
  kind: 'plan' | 'todo'
  stages: PlanStage[]
  state: PlanState
  note: string | null
  startedAt: number
  agents?: AgentRun[]
  agentsDoneAt?: number | null
}

// what the session is doing, for the dot at the start of the band
export type Activity = 'idle' | 'running' | 'waiting'

declare module 'claude-code' {
  interface PluginState {
    tracking: {
      usage: Usage
      // bumped every second while a countdown runs, so the band redraws
      tick: number
      isHidden: boolean
      activity: Activity
      // the last quota threshold each window crossed (0, 80 or 95), so an alert sounds once
      alerted: Record<string, number>
      plans: Plan[]
      isOpen: boolean
      progressTick: number
    }
  }
}
