import { SeismicEngine } from './engine'
import { DEFAULT_PARAMS, G } from './physics'

/** Roof displacement (m, full-scale equivalent) per g of measured model acceleration. */
const GAIN = 3
/** Pendulum used to estimate the damper motion from the measured roof of tower 2. */
const PEND_W = 2 * Math.PI * 1.9
const PEND_Z = 0.13

export interface SensorSample { a: number; b: number; active: boolean }

/**
 * Drives the 3D towers from live sensor readings instead of the integrator.
 * Each tower deflects in its first mode shape, scaled so the roof follows its sensor;
 * the TMD pendulum position is estimated by integrating a tuned pendulum hung from the measured roof.
 */
export class SensorEngine extends SeismicEngine {
  private read: () => SensorSample
  private sa = 0
  private sb = 0
  private phi: Float64Array
  private y = 0
  private yv = 0
  private prevU = 0
  hasB = true

  constructor(read: () => SensorSample) {
    super({ ...DEFAULT_PARAMS, tmdEnabled: true })
    this.read = read
    const n = this.p.stories
    this.phi = new Float64Array(n)
    const top = Math.sin((n * Math.PI) / (2 * n + 1))
    for (let j = 0; j < n; j++) this.phi[j] = Math.sin(((j + 1) * Math.PI) / (2 * n + 1)) / top
    this.playing = true
  }

  /** clear peaks / damage before a new test */
  resetMetrics() {
    this.rebuild()
    this.playing = true
    this.y = this.yv = this.prevU = 0
  }

  agAt() { return 0 }
  groundDispAt() { return 0 }

  advance(realDt: number) {
    const dt = Math.min(Math.max(realDt, 1e-4), 0.05)
    const r = this.read()
    this.hasB = !Number.isNaN(r.b)
    const k = 1 - Math.exp(-dt / 0.03) // light smoothing so the 3D view doesn't jitter
    const a = r.active ? r.a : 0
    const b = r.active && this.hasB ? r.b : 0
    this.sa += (a - this.sa) * k
    this.sb += (b - this.sb) * k

    const n = this.p.stories
    const ra = this.sa * GAIN
    const rb = this.sb * GAIN
    for (let j = 0; j < n; j++) {
      const xa = ra * this.phi[j], xb = rb * this.phi[j]
      this.bare.v[j] = (xa - this.bare.x[j]) / dt
      this.tmd.v[j] = (xb - this.tmd.x[j]) / dt
      this.bare.x[j] = xa
      this.tmd.x[j] = xb
    }

    // estimated pendulum: absolute position y hung from the moving roof u
    const u = rb
    const ud = (u - this.prevU) / dt
    this.prevU = u
    const sub = 8, h = dt / sub
    const lim = this.p.stroke * 1.12
    for (let i = 0; i < sub; i++) {
      const acc = -2 * PEND_Z * PEND_W * (this.yv - ud) - PEND_W * PEND_W * (this.y - u)
      this.yv += h * acc
      this.y += h * this.yv
      const s = this.y - u
      if (Math.abs(s) > lim) { this.y = u + Math.sign(s) * lim; this.yv = ud } // bumper ring
    }
    this.tmd.x[n] = this.y
    this.tmd.v[n] = this.yv

    this.t += dt
    if (r.active) {
      this.track(this.bare, this.mBare, this.accB, 0)
      this.track(this.tmd, this.mTmd, this.accT, 0)
      const s = Math.abs(this.strokeNow())
      this.peakStroke = Math.max(this.peakStroke, s)
    }
  }

  /** current smoothed readings in g (for overlays) */
  readings() { return { a: this.sa, b: this.sb, roofA: this.sa * GAIN, roofB: this.sb * GAIN, g: G } }
}
