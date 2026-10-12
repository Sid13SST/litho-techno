import { useCallback, useEffect, useRef, useState } from 'react'
import { assessCondition, type SeismicEngine, type TowerMetrics } from '../sim/engine'
import { G } from '../sim/physics'
import { alertSound } from './sound'

export type AlertSource = 'Simulation' | 'Arduino' | 'Virtual table' | 'Test'

export const ALERT_LEVELS = [
  { id: 0, name: 'Normal', min: 0, mmi: 'I–III', color: '#34d399', action: 'No significant shaking. Monitoring.', tone: 'ok' },
  { id: 1, name: 'Advisory', min: 0.02, mmi: 'IV–V', color: '#fbbf24', action: 'Light shaking. Stay alert and away from shelves and glass.', tone: 'warn' },
  { id: 2, name: 'Warning', min: 0.06, mmi: 'VI–VII', color: '#fb923c', action: 'Strong shaking. DROP, COVER and HOLD ON.', tone: 'warn' },
  { id: 3, name: 'Severe', min: 0.15, mmi: 'VIII+', color: '#f43f5e', action: 'Violent shaking. DROP, COVER, HOLD ON now. Stay away from windows.', tone: 'bad' },
] as const

export function levelFor(g: number) {
  for (let i = ALERT_LEVELS.length - 1; i > 0; i--) if (g >= ALERT_LEVELS[i].min) return i
  return 0
}

export type StabilityTrigger = 'Marginal' | 'Unstable'
export interface AlertSettings { sound: boolean; volume: number; threshold: 1 | 2 | 3; vibrate: boolean; structural: boolean; structLevel: StabilityTrigger }
export interface AlertEvent { start: number; end: number; peak: number; level: number; source: AlertSource; kind?: 'quake' | 'structure'; detail?: string }

/** structural-stability alarm: fires when a tower's stability status drops to Marginal/Unstable */
export interface StructuralState {
  active: boolean
  acknowledged: boolean
  tower: string
  status: 'Stable' | 'Marginal' | 'Unstable'
  stability: number // % margin to the 2.5 % collapse-prevention drift
  theta: number
  worstFloor: number
  source: AlertSource | null
  sounding: boolean
}
export interface AlertState {
  active: boolean
  acknowledged: boolean
  level: number // current level (from the shaking envelope)
  maxLevel: number // worst level reached in this event
  value: number // envelope, g
  peak: number // event peak, g
  source: AlertSource | null
  startedAt: number
  eta: number | null // s until the simulated strong phase (early warning)
  allClearAt: number // timestamp of the last event end (for the "all clear" toast)
  structural: StructuralState
}

const STRUCT_IDLE: StructuralState = { active: false, acknowledged: false, tower: '', status: 'Stable', stability: 100, theta: 0, worstFloor: 0, source: null, sounding: false }

const SETTINGS_KEY = 'lithotechno-alert-settings'
const DEFAULT_SETTINGS: AlertSettings = { sound: true, volume: 0.6, threshold: 1, vibrate: true, structural: true, structLevel: 'Marginal' }
const HISTORY_KEY = 'lithotechno-alert-history'
const HOLD_MS = 4000 // keep the alert up this long after shaking drops below the threshold
const TICK = 100

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } : fallback } catch { return fallback }
}

/** scripted 10 s test quake (g) */
function testShake(ms: number) {
  const t = ms / 1000
  const env = t < 3 ? t / 3 : t < 6.5 ? 1 : Math.max(0, 1 - (t - 6.5) / 2.5)
  return env * 0.22 * (0.75 + 0.25 * Math.abs(Math.sin(t * 9)))
}

export function useAlertMonitor(
  engine: SeismicEngine,
  sensor: { sample: () => { a: number; b: number; active: boolean }; connected: boolean; demo: boolean },
  sensorEngine: SeismicEngine,
) {
  const [settings, setSettingsState] = useState<AlertSettings>(() => load(SETTINGS_KEY, DEFAULT_SETTINGS))
  const [history, setHistory] = useState<AlertEvent[]>(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
  })
  const [state, setState] = useState<AlertState>({ active: false, acknowledged: false, level: 0, maxLevel: 0, value: 0, peak: 0, source: null, startedAt: 0, eta: null, allClearAt: 0, structural: STRUCT_IDLE })

  const st = useRef(state)
  const env = useRef(0)
  const lastHot = useRef(0)
  const testStart = useRef<number | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const sensorRef = useRef(sensor)
  sensorRef.current = sensor

  const setSettings = useCallback((p: Partial<AlertSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...p }
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  useEffect(() => { alertSound.setVolume(settings.volume) }, [settings.volume])

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      // --- gather candidate signals (g) ---
      const cands: { v: number; src: AlertSource }[] = []
      if (engine.playing) cands.push({ v: Math.abs(engine.agAt(engine.t)) / G, src: 'Simulation' })
      const sens = sensorRef.current
      const smp = sens.sample()
      if (smp.active) cands.push({ v: Math.max(Math.abs(smp.a), Number.isNaN(smp.b) ? 0 : Math.abs(smp.b)), src: sens.connected ? 'Arduino' : 'Virtual table' })
      if (testStart.current !== null) {
        const el = now - testStart.current
        if (el > 9500) testStart.current = null
        else cands.push({ v: testShake(el), src: 'Test' })
      }
      const top = cands.reduce((m, c) => (c.v > m.v ? c : m), { v: 0, src: 'Simulation' as AlertSource })

      // --- envelope: ground motion crosses zero constantly, so track a decaying peak ---
      env.current = Math.max(top.v, env.current * Math.exp(-TICK / 900))
      const level = levelFor(env.current)
      const prev = st.current
      const s = settingsRef.current
      let next: AlertState = { ...prev, level, value: env.current }

      if (level >= s.threshold) lastHot.current = now
      if (!prev.active && level >= s.threshold) {
        next = { ...next, active: true, acknowledged: false, startedAt: now, peak: env.current, maxLevel: level, source: top.src }
        if (s.vibrate && 'vibrate' in navigator) try { navigator.vibrate([400, 150, 400, 150, 400]) } catch { /* ignore */ }
      } else if (prev.active) {
        next.peak = Math.max(prev.peak, env.current)
        next.maxLevel = Math.max(prev.maxLevel, level)
        if (top.v > 0.005) next.source = top.src
        if (now - lastHot.current > HOLD_MS) {
          const ev: AlertEvent = { start: prev.startedAt, end: now, peak: next.peak, level: next.maxLevel, source: prev.source ?? top.src }
          setHistory((h) => {
            const nh = [ev, ...h].slice(0, 30)
            try { localStorage.setItem(HISTORY_KEY, JSON.stringify(nh)) } catch { /* ignore */ }
            return nh
          })
          next = { ...next, active: false, acknowledged: false, maxLevel: 0, peak: 0, source: null, allClearAt: now }
        }
      }

      // --- structural stability: worst tower across the simulator and the sensor-driven model ---
      const sources: { e: SeismicEngine; src: AlertSource; live: boolean }[] = [
        { e: engine, src: 'Simulation', live: engine.playing },
        { e: sensorEngine, src: sens.connected ? 'Arduino' : 'Virtual table', live: smp.active },
      ]
      let worst: { tower: string; c: ReturnType<typeof assessCondition>; src: AlertSource; live: boolean } | null = null
      for (const { e, src, live } of sources) {
        if (!e.mBare.samples) continue
        const towers: [TowerMetrics, string][] = [[e.mBare, 'Conventional tower']]
        if (e.p.tmdEnabled) towers.push([e.mTmd, 'Tower with TMD'])
        for (const [m, tower] of towers) {
          const c = assessCondition(m)
          if (!worst || c.stability < worst.c.stability) worst = { tower, c, src, live }
        }
      }
      const unsafe = !!worst && (s.structLevel === 'Marginal' ? worst.c.status !== 'Stable' : worst.c.status === 'Unstable')
      const ps = prev.structural
      let ns: StructuralState = ps
      if (s.structural && unsafe && worst) {
        ns = {
          active: true,
          acknowledged: ps.active ? ps.acknowledged : false,
          tower: worst.tower, status: worst.c.status, stability: worst.c.stability, theta: worst.c.theta,
          worstFloor: worst.c.worstFloor, source: worst.src,
          sounding: false,
        }
        if (!ps.active) {
          if (s.vibrate && 'vibrate' in navigator) try { navigator.vibrate([150, 100, 150, 100, 600]) } catch { /* ignore */ }
          const ev: AlertEvent = { start: now, end: now, peak: worst.c.stability, level: worst.c.status === 'Unstable' ? 3 : 2, source: worst.src, kind: 'structure', detail: `${worst.tower} ${worst.c.status.toLowerCase()} · stability ${worst.c.stability.toFixed(0)}% · floor ${worst.c.worstFloor}` }
          setHistory((h) => {
            const nh = [ev, ...h].slice(0, 30)
            try { localStorage.setItem(HISTORY_KEY, JSON.stringify(nh)) } catch { /* ignore */ }
            return nh
          })
        }
        // ring while the building is still being shaken; it goes quiet once the run ends but the warning stays up
        ns.sounding = !ns.acknowledged && s.sound && worst.live
      } else if (ps.active) {
        ns = STRUCT_IDLE // metrics were reset (new run) or the alarm was switched off
      }
      next.structural = ns
      alertSound.playStructural(ns.sounding)

      // early warning: in the simulation the strong phase is still ahead during the build-up
      next.eta = next.active && top.src === 'Simulation' && engine.t < engine.rec.strongStart ? engine.rec.strongStart - engine.t : null

      // --- sound ---
      // while the alert is up, sound follows the live level (at least the chime during the hold-off tail)
      alertSound.play(next.active && !next.acknowledged && s.sound ? Math.max(1, level) : 0)

      const changed = next.active !== prev.active || next.level !== prev.level || next.acknowledged !== prev.acknowledged ||
        Math.abs(next.value - prev.value) > 0.002 || next.source !== prev.source || (next.eta === null) !== (prev.eta === null) ||
        (next.eta !== null && prev.eta !== null && Math.ceil(next.eta) !== Math.ceil(prev.eta)) || next.allClearAt !== prev.allClearAt ||
        ns.active !== ps.active || ns.acknowledged !== ps.acknowledged || ns.sounding !== ps.sounding || ns.status !== ps.status || ns.tower !== ps.tower || Math.abs(ns.stability - ps.stability) >= 1
      st.current = next
      if (changed) setState(next)
    }, TICK)
    return () => { clearInterval(id); alertSound.stop(); alertSound.playStructural(false) }
  }, [engine, sensorEngine])

  const acknowledge = useCallback(() => {
    st.current = { ...st.current, acknowledged: true }
    setState(st.current)
    alertSound.stop()
  }, [])

  const acknowledgeStructural = useCallback(() => {
    st.current = { ...st.current, structural: { ...st.current.structural, acknowledged: true, sounding: false } }
    setState(st.current)
    alertSound.playStructural(false)
  }, [])

  const runTest = useCallback(() => {
    alertSound.unlock()
    testStart.current = Date.now()
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    try { localStorage.removeItem(HISTORY_KEY) } catch { /* ignore */ }
  }, [])

  return { state, settings, setSettings, history, acknowledge, acknowledgeStructural, runTest, clearHistory, testing: testStart.current !== null }
}

export type AlertMonitor = ReturnType<typeof useAlertMonitor>
