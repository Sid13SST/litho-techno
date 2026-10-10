// Structural dynamics core.
// A building is modelled as a lumped-mass shear chain: DOF j is connected to DOF j-1
// (or the ground for j = 0) by a spring k[j] and dashpot c[j]. A tuned mass damper is
// simply one more DOF hanging off the roof, with a stiff bumper beyond its stroke limit
// so the mass physically can never leave its chamber.

export const G = 9.80665

export type Scenario = 'quake' | 'resonance' | 'pulse'

export interface SimParams {
  stories: number
  storyHeight: number // m
  floorMass: number // kg per floor
  f1: number // Hz, fundamental frequency of the bare building
  zeta: number // structural damping ratio (mode 1)
  tmdEnabled: boolean
  mu: number // TMD mass / modal mass of mode 1
  tuning: number // multiplier applied to the optimal TMD frequency (1 = optimal)
  zetaD: number // TMD damping ratio
  stroke: number // m, TMD stroke before hitting the bumper ring
  scenario: Scenario
  magnitude: number
  seed: number
}

export const DEFAULT_PARAMS: SimParams = {
  stories: 20,
  storyHeight: 3.6,
  floorMass: 1.2e6,
  f1: 0.55,
  zeta: 0.02,
  tmdEnabled: true,
  mu: 0.05,
  tuning: 1,
  zetaD: optimalTmd(0.05).zeta,
  stroke: 1.8,
  scenario: 'quake',
  magnitude: 6.8,
  seed: 7,
}

/** Warburton (1982) optimum for a TMD under ground acceleration, minimising roof displacement. */
export function optimalTmd(mu: number) {
  return {
    freqRatio: Math.sqrt(1 - mu / 2) / (1 + mu),
    zeta: Math.sqrt((3 * mu * (1 - mu / 4)) / (8 * (1 + mu) * (1 - mu / 2))),
  }
}

/** Mode-1 data of a uniform fixed-free shear chain (closed form). */
export function buildingModal(p: SimParams) {
  const n = p.stories
  const w1 = 2 * Math.PI * p.f1
  const s = Math.sin(Math.PI / (2 * (2 * n + 1)))
  const k = p.floorMass * (w1 / (2 * s)) ** 2
  const phiTop = Math.sin((n * Math.PI) / (2 * n + 1))
  let modalMass = 0
  for (let j = 1; j <= n; j++) modalMass += p.floorMass * (Math.sin((j * Math.PI) / (2 * n + 1)) / phiTop) ** 2
  return { w1, k, modalMass, totalMass: n * p.floorMass }
}

export function tmdProperties(p: SimParams) {
  const { w1, modalMass } = buildingModal(p)
  const opt = optimalTmd(p.mu)
  const md = p.mu * modalMass
  const wd = w1 * opt.freqRatio * p.tuning
  return { md, wd, fd: wd / (2 * Math.PI), kd: md * wd * wd, cd: 2 * p.zetaD * md * wd, opt }
}

export class Chain {
  readonly n: number
  readonly m: Float64Array
  readonly k: Float64Array
  readonly c: Float64Array
  readonly x: Float64Array
  readonly v: Float64Array
  /** index of the spring with a bumper (the TMD), or -1 */
  bumperIdx = -1
  gap = Infinity
  kb = 0
  cb = 0
  private f: Float64Array
  private k1x: Float64Array; private k1v: Float64Array
  private k2x: Float64Array; private k2v: Float64Array
  private k3x: Float64Array; private k3v: Float64Array
  private k4x: Float64Array; private k4v: Float64Array
  private tx: Float64Array; private tv: Float64Array

  constructor(n: number) {
    this.n = n
    const a = () => new Float64Array(n)
    this.m = a(); this.k = a(); this.c = a(); this.x = a(); this.v = a(); this.f = a()
    this.k1x = a(); this.k1v = a(); this.k2x = a(); this.k2v = a()
    this.k3x = a(); this.k3v = a(); this.k4x = a(); this.k4v = a()
    this.tx = a(); this.tv = a()
  }

  /** relative accelerations for ground acceleration ag (m/s²) */
  accel(x: Float64Array, v: Float64Array, ag: number, out: Float64Array) {
    const { n, k, c, m, f } = this
    f.fill(0)
    for (let j = 0; j < n; j++) {
      const dx = j > 0 ? x[j] - x[j - 1] : x[j]
      const dv = j > 0 ? v[j] - v[j - 1] : v[j]
      let s = k[j] * dx + c[j] * dv
      if (j === this.bumperIdx) {
        const over = Math.abs(dx) - this.gap
        // Hunt–Crossley style contact: damping ramps in with penetration, so impacts stay smooth
        if (over > 0) s += Math.sign(dx) * this.kb * over + this.cb * Math.min(over / 0.15, 1) * dv
      }
      f[j] -= s
      if (j > 0) f[j - 1] += s
    }
    for (let j = 0; j < n; j++) out[j] = f[j] / m[j] - ag
  }

  /** classic RK4; ag0/agm/ag1 = ground accel at t, t+h/2, t+h */
  step(h: number, ag0: number, agm: number, ag1: number) {
    const { n, x, v, tx, tv, k1x, k1v, k2x, k2v, k3x, k3v, k4x, k4v } = this
    k1x.set(v); this.accel(x, v, ag0, k1v)
    for (let j = 0; j < n; j++) { tx[j] = x[j] + 0.5 * h * k1x[j]; tv[j] = v[j] + 0.5 * h * k1v[j] }
    k2x.set(tv); this.accel(tx, tv, agm, k2v)
    for (let j = 0; j < n; j++) { tx[j] = x[j] + 0.5 * h * k2x[j]; tv[j] = v[j] + 0.5 * h * k2v[j] }
    k3x.set(tv); this.accel(tx, tv, agm, k3v)
    for (let j = 0; j < n; j++) { tx[j] = x[j] + h * k3x[j]; tv[j] = v[j] + h * k3v[j] }
    k4x.set(tv); this.accel(tx, tv, ag1, k4v)
    for (let j = 0; j < n; j++) {
      x[j] += (h / 6) * (k1x[j] + 2 * k2x[j] + 2 * k3x[j] + k4x[j])
      v[j] += (h / 6) * (k1v[j] + 2 * k2v[j] + 2 * k3v[j] + k4v[j])
    }
  }

  reset() { this.x.fill(0); this.v.fill(0) }
}

export function buildChain(p: SimParams, withTmd: boolean): Chain {
  const { w1, k } = buildingModal(p)
  const n = p.stories
  const ch = new Chain(withTmd ? n + 1 : n)
  const beta = (2 * p.zeta) / w1 // stiffness-proportional damping: ζ1 exact, higher modes damped more
  for (let j = 0; j < n; j++) { ch.m[j] = p.floorMass; ch.k[j] = k; ch.c[j] = beta * k }
  if (withTmd) applyTmd(ch, p)
  return ch
}

/** (re)apply TMD coefficients in place, so tuning can change mid-run */
export function applyTmd(ch: Chain, p: SimParams) {
  const t = tmdProperties(p)
  const i = p.stories
  ch.m[i] = t.md; ch.k[i] = t.kd; ch.c[i] = t.cd
  ch.bumperIdx = i
  ch.gap = p.stroke
  ch.kb = 18 * t.md * buildingModal(p).w1 ** 2 // elastomeric bumper ring
  ch.cb = 2 * 1.0 * Math.sqrt(ch.kb * t.md)
}

/* ------------------------------------------------------------------ */
/* Frequency response (complex tridiagonal solve)                       */
/* ------------------------------------------------------------------ */

/** |roof displacement| per unit ground acceleration, normalised by the bare building's static value */
export function frequencyResponse(p: SimParams, fMin: number, fMax: number, count: number) {
  const bare = buildChain(p, false)
  const tmd = buildChain(p, true)
  const freqs = new Float64Array(count)
  const hb = new Float64Array(count)
  const ht = new Float64Array(count)
  const staticTop = roofResponse(bare, 0, p.stories - 1)
  for (let i = 0; i < count; i++) {
    const f = fMin + ((fMax - fMin) * i) / (count - 1)
    freqs[i] = f
    const w = 2 * Math.PI * f
    hb[i] = roofResponse(bare, w, p.stories - 1) / staticTop
    ht[i] = roofResponse(tmd, w, p.stories - 1) / staticTop
  }
  return { freqs, bare: hb, tmd: ht }
}

function roofResponse(ch: Chain, w: number, roof: number) {
  const n = ch.n
  // A = K - w²M + iwC (tridiagonal, symmetric). rhs = -m (unit ground accel)
  const dr = new Float64Array(n), di = new Float64Array(n)
  const or = new Float64Array(n), oi = new Float64Array(n) // off-diagonal between j and j+1
  const br = new Float64Array(n), bi = new Float64Array(n)
  for (let j = 0; j < n; j++) {
    const kn = j + 1 < n ? ch.k[j + 1] : 0
    const cn = j + 1 < n ? ch.c[j + 1] : 0
    dr[j] = ch.k[j] + kn - w * w * ch.m[j]
    di[j] = w * (ch.c[j] + cn)
    or[j] = -kn; oi[j] = -w * cn
    br[j] = -ch.m[j]; bi[j] = 0
  }
  // Thomas algorithm in complex arithmetic
  const cr = new Float64Array(n), ci = new Float64Array(n)
  const yr = new Float64Array(n), yi = new Float64Array(n)
  for (let j = 0; j < n; j++) {
    let ar = dr[j], ai = di[j]
    let rr = br[j], ri = bi[j]
    if (j > 0) {
      // a -= o[j-1] * c'[j-1]; r -= o[j-1] * y[j-1]
      ar -= or[j - 1] * cr[j - 1] - oi[j - 1] * ci[j - 1]
      ai -= or[j - 1] * ci[j - 1] + oi[j - 1] * cr[j - 1]
      rr -= or[j - 1] * yr[j - 1] - oi[j - 1] * yi[j - 1]
      ri -= or[j - 1] * yi[j - 1] + oi[j - 1] * yr[j - 1]
    }
    const den = ar * ar + ai * ai
    cr[j] = (or[j] * ar + oi[j] * ai) / den
    ci[j] = (oi[j] * ar - or[j] * ai) / den
    yr[j] = (rr * ar + ri * ai) / den
    yi[j] = (ri * ar - rr * ai) / den
  }
  const xr = new Float64Array(n), xi = new Float64Array(n)
  for (let j = n - 1; j >= 0; j--) {
    xr[j] = yr[j]; xi[j] = yi[j]
    if (j < n - 1) {
      xr[j] -= cr[j] * xr[j + 1] - ci[j] * xi[j + 1]
      xi[j] -= cr[j] * xi[j + 1] + ci[j] * xr[j + 1]
    }
  }
  return Math.hypot(xr[roof], xi[roof])
}
