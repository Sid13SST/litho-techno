import { applyTmd, buildChain, G, type Chain, type SimParams } from './physics'
import { makeRecord, sampleRecord, type GroundRecord } from './ground'

const H = 1 / 480 // integration step (s)
const HIST_RATE = 60 // history samples per simulated second
const TAIL = 8 // seconds of free vibration after the record ends

export interface TowerMetrics {
  peakRoof: number // m
  peakIdr: number // inter-story drift ratio (fraction)
  peakAcc: number // absolute roof accel (g)
  peakShear: number // base shear / weight
  sumSq: number
  samples: number
  storyPeakIdr: Float64Array
  floorPeakDisp: Float64Array // peak |x| of every floor (m)
  peakTheta: number // worst P-delta stability coefficient
}

function emptyMetrics(stories: number): TowerMetrics {
  return { peakRoof: 0, peakIdr: 0, peakAcc: 0, peakShear: 0, sumSq: 0, samples: 0, storyPeakIdr: new Float64Array(stories), floorPeakDisp: new Float64Array(stories), peakTheta: 0 }
}

export class History {
  readonly cap: number
  readonly t: Float32Array
  readonly ag: Float32Array
  readonly bare: Float32Array
  readonly tmd: Float32Array
  readonly stroke: Float32Array
  count = 0
  constructor(cap: number) {
    this.cap = cap
    this.t = new Float32Array(cap); this.ag = new Float32Array(cap)
    this.bare = new Float32Array(cap); this.tmd = new Float32Array(cap); this.stroke = new Float32Array(cap)
  }
  push(t: number, ag: number, b: number, d: number, s: number) {
    if (this.count >= this.cap) return
    const i = this.count++
    this.t[i] = t; this.ag[i] = ag; this.bare[i] = b; this.tmd[i] = d; this.stroke[i] = s
  }
}

export class SeismicEngine {
  p: SimParams
  rec!: GroundRecord
  bare!: Chain
  tmd!: Chain
  t = 0
  playing = false
  finished = false
  speed = 1
  mBare!: TowerMetrics
  mTmd!: TowerMetrics
  peakStroke = 0
  bumperHits = 0
  private inBumper = false
  hist!: History
  private nextSample = 0
  protected accB: Float64Array
  protected accT: Float64Array
  /** bumps whenever a run is rebuilt, so views can reset themselves */
  epoch = 0

  constructor(p: SimParams) {
    this.p = { ...p }
    this.accB = new Float64Array(p.stories)
    this.accT = new Float64Array(p.stories + 1)
    this.rebuild()
  }

  get endTime() { return this.rec.duration + TAIL }

  rebuild() {
    const p = this.p
    this.rec = makeRecord(p.scenario, p.magnitude, p.f1, p.seed)
    this.bare = buildChain(p, false)
    this.tmd = buildChain(p, p.tmdEnabled)
    this.accB = new Float64Array(this.bare.n)
    this.accT = new Float64Array(this.tmd.n)
    this.t = 0
    this.finished = false
    this.mBare = emptyMetrics(p.stories)
    this.mTmd = emptyMetrics(p.stories)
    this.peakStroke = 0
    this.bumperHits = 0
    this.inBumper = false
    this.hist = new History(Math.ceil(this.endTime * HIST_RATE) + 4)
    this.nextSample = 0
    this.epoch++
  }

  /** params that require a full restart vs. ones that can be tuned live */
  update(next: Partial<SimParams>) {
    const prev = this.p
    this.p = { ...prev, ...next }
    const restartKeys: (keyof SimParams)[] = ['scenario', 'magnitude', 'seed', 'f1', 'zeta', 'tmdEnabled', 'stories']
    if (restartKeys.some((k) => next[k] !== undefined && next[k] !== prev[k])) {
      const wasPlaying = this.playing
      this.rebuild()
      this.playing = wasPlaying
    } else if (this.p.tmdEnabled) {
      applyTmd(this.tmd, this.p)
    }
  }

  restart(play = true) {
    this.rebuild()
    this.playing = play
  }

  agAt(t: number) { return sampleRecord(this.rec.ag, this.rec.dt, t) }
  groundDispAt(t: number) { return sampleRecord(this.rec.disp, this.rec.dt, t) }

  roof(ch: Chain) { return ch.x[this.p.stories - 1] }
  strokeNow() { return this.p.tmdEnabled ? this.tmd.x[this.p.stories] - this.tmd.x[this.p.stories - 1] : 0 }

  advance(realDt: number) {
    if (!this.playing || this.finished) return
    const simDt = Math.min(realDt, 1 / 20) * this.speed
    const steps = Math.max(1, Math.round(simDt / H))
    for (let i = 0; i < steps; i++) this.substep()
  }

  private substep() {
    const t = this.t
    const a0 = this.agAt(t), am = this.agAt(t + H / 2), a1 = this.agAt(t + H)
    this.bare.step(H, a0, am, a1)
    this.tmd.step(H, a0, am, a1)
    this.t = t + H
    this.track(this.bare, this.mBare, this.accB, a1)
    this.track(this.tmd, this.mTmd, this.accT, a1)

    if (this.p.tmdEnabled) {
      const s = Math.abs(this.strokeNow())
      this.peakStroke = Math.max(this.peakStroke, s)
      const hit = s > this.p.stroke
      if (hit && !this.inBumper) this.bumperHits++
      this.inBumper = hit
    }

    if (this.t >= this.nextSample) {
      this.hist.push(this.t, a1 / G, this.roof(this.bare), this.roof(this.tmd), this.strokeNow())
      this.nextSample += 1 / HIST_RATE
    }
    if (this.t >= this.endTime) { this.finished = true; this.playing = false }
  }

  protected track(ch: Chain, m: TowerMetrics, acc: Float64Array, ag: number) {
    const n = this.p.stories
    const h = this.p.storyHeight
    const x = ch.x
    const roof = x[n - 1]
    m.peakRoof = Math.max(m.peakRoof, Math.abs(roof))
    m.sumSq += roof * roof
    m.samples++
    let wAbove = 0
    for (let j = ch.n - 1; j >= 0; j--) {
      wAbove += ch.m[j] * G
      if (j >= n) continue // TMD DOF
      const ax = Math.abs(x[j])
      if (ax > m.floorPeakDisp[j]) m.floorPeakDisp[j] = ax
      const drift = x[j] - (j > 0 ? x[j - 1] : 0)
      const idr = Math.abs(drift) / h
      if (idr > m.storyPeakIdr[j]) m.storyPeakIdr[j] = idr
      if (idr > m.peakIdr) m.peakIdr = idr
      // P-delta stability coefficient θ = P·Δ / (V·h)  (ASCE 7 §12.8.7); with an elastic story V = k·Δ → θ = P / (k·h)
      // amplified by the drift demand relative to yield (≈0.5 % drift) once the story goes inelastic
      const theta = (wAbove / (ch.k[j] * h)) * Math.max(1, idr / 0.005)
      if (theta > m.peakTheta) m.peakTheta = theta
    }
    // base shear = spring + dashpot force of the first story
    const shear = Math.abs(ch.k[0] * x[0] + ch.c[0] * ch.v[0])
    let w = 0
    for (let j = 0; j < ch.n; j++) w += ch.m[j]
    m.peakShear = Math.max(m.peakShear, shear / (w * G))
    // absolute roof acceleration (comfort / contents damage)
    ch.accel(ch.x, ch.v, ag, acc)
    m.peakAcc = Math.max(m.peakAcc, Math.abs(acc[n - 1] + ag) / G)
  }

  rms(m: TowerMetrics) { return m.samples ? Math.sqrt(m.sumSq / m.samples) : 0 }
}

export function reduction(bare: number, withTmd: number) {
  return bare > 1e-9 ? (1 - withTmd / bare) * 100 : 0
}

/** drift-ratio performance levels (FEMA-356-style, simplified) */
export function driftLevel(idr: number) {
  if (idr < 0.002) return { label: 'Elastic', tone: 'ok' as const }
  if (idr < 0.007) return { label: 'Immediate occupancy', tone: 'ok' as const }
  if (idr < 0.015) return { label: 'Repairable damage', tone: 'warn' as const }
  if (idr < 0.025) return { label: 'Life safety', tone: 'bad' as const }
  return { label: 'Collapse risk', tone: 'bad' as const }
}

/* ---------------- condition & stability assessment ---------------- */

export type DamageState = 0 | 1 | 2 | 3 | 4
export const DAMAGE_STATES = [
  { label: 'None', short: 'OK', color: '#34d399', weight: 0 },
  { label: 'Slight', short: 'Slight', color: '#a3e635', weight: 0.05 },
  { label: 'Moderate', short: 'Mod.', color: '#fbbf24', weight: 0.25 },
  { label: 'Extensive', short: 'Ext.', color: '#fb923c', weight: 0.6 },
  { label: 'Complete', short: 'Severe', color: '#f43f5e', weight: 1 },
] as const

/** HAZUS-style structural damage state of a high-rise steel moment frame from peak inter-story drift */
export function damageState(idr: number): DamageState {
  if (idr < 0.003) return 0
  if (idr < 0.006) return 1
  if (idr < 0.012) return 2
  if (idr < 0.03) return 3
  return 4
}

export interface Condition {
  health: number // 0–100 %
  stability: number // 0–100 % margin against the collapse-prevention drift limit
  theta: number
  status: 'Stable' | 'Marginal' | 'Unstable'
  counts: number[] // floors in each damage state
  worstFloor: number // 1-based
}

export function assessCondition(m: TowerMetrics): Condition {
  const counts = [0, 0, 0, 0, 0]
  let dmg = 0, worst = 0
  m.storyPeakIdr.forEach((idr, j) => {
    const ds = damageState(idr)
    counts[ds]++
    dmg += DAMAGE_STATES[ds].weight
    if (idr > m.storyPeakIdr[worst]) worst = j
  })
  const health = 100 * (1 - dmg / m.storyPeakIdr.length)
  const stability = Math.max(0, 100 * (1 - m.peakIdr / 0.025)) // 2.5 % drift ≈ collapse prevention
  const status = m.peakIdr >= 0.025 || m.peakTheta > 0.25 ? 'Unstable' : m.peakIdr >= 0.015 || m.peakTheta > 0.1 ? 'Marginal' : 'Stable'
  return { health, stability, theta: m.peakTheta, status, counts, worstFloor: worst + 1 }
}
