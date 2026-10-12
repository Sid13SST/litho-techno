import { G, type Scenario } from './physics'

export interface GroundRecord {
  dt: number
  ag: Float32Array // m/s²
  disp: Float32Array // visual ground displacement (m, smoothed)
  duration: number
  pga: number // g
  strongStart: number
  strongEnd: number
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function gaussian(rand: () => number) {
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** Simplified magnitude → peak ground acceleration (g) at ~20 km epicentral distance. */
export function pgaFromMagnitude(m: number) {
  return Math.min(0.75, 10 ** (0.36 * m - 3.1))
}

export function strongDuration(m: number) {
  return Math.min(26, Math.max(4, 4 + 5.5 * (m - 5)))
}

export function intensityLabel(pgaG: number) {
  if (pgaG < 0.014) return { mmi: 'IV', text: 'Light' }
  if (pgaG < 0.039) return { mmi: 'V', text: 'Moderate' }
  if (pgaG < 0.092) return { mmi: 'VI', text: 'Strong' }
  if (pgaG < 0.18) return { mmi: 'VII', text: 'Very strong' }
  if (pgaG < 0.34) return { mmi: 'VIII', text: 'Severe' }
  if (pgaG < 0.65) return { mmi: 'IX', text: 'Violent' }
  return { mmi: 'X+', text: 'Extreme' }
}

export const SCENARIOS: Record<Scenario, { name: string; short: string; blurb: string }> = {
  quake: {
    name: 'Soft-soil earthquake',
    short: 'Earthquake',
    blurb: 'Soft lake-bed soil (like Mexico City 1985) filters the shaking into long, rhythmic waves near the tower period, the kind that makes tall buildings resonate.',
  },
  resonance: {
    name: 'Resonance test',
    short: 'Resonance',
    blurb: "Steady shaking exactly at the tower's natural frequency: the worst case, and where a TMD shines.",
  },
  pulse: {
    name: 'Near-fault pulse',
    short: 'Fault pulse',
    blurb: 'A short, violent velocity pulse typical of sites right next to a rupturing fault.',
  },
}

/**
 * Builds a deterministic ground-acceleration record.
 * @param f1 building fundamental frequency (Hz) – the scenarios are built around it so the demo is meaningful
 */
export function makeRecord(scenario: Scenario, magnitude: number, f1: number, seed: number): GroundRecord {
  const dt = 0.01
  const pga = pgaFromMagnitude(magnitude)
  const rand = mulberry32(seed * 7919 + Math.round(magnitude * 10))
  const Ds = strongDuration(magnitude)
  let duration: number
  let strongStart: number
  let strongEnd: number
  let raw: Float64Array
  let disp: Float64Array

  if (scenario === 'quake') {
    const tr = 2 + 0.25 * Ds
    const td = 0.9 * Ds + 4
    duration = tr + Ds + td
    strongStart = tr
    strongEnd = tr + Ds
    const n = Math.ceil(duration / dt)
    raw = new Float64Array(n)
    disp = new Float64Array(n)
    // Clough–Penzien: white noise → soil filter (wg, zg) → high-pass (wf, zf)
    const wg = 2 * Math.PI * f1 // lakebed-type soft soil: narrow-band shaking centred on the tower period
    const zg = 0.12
    const wf = 0.12 * wg
    const zf = 0.7
    let xg = 0, vg = 0, xf = 0, vf = 0
    const sub = 8
    const h = dt / sub
    for (let i = 0; i < n; i++) {
      const t = i * dt
      const env = t < tr ? (t / tr) ** 2 : t < tr + Ds ? 1 : Math.exp((-3.2 * (t - tr - Ds)) / td)
      const w = gaussian(rand) / Math.sqrt(h)
      let a = 0
      for (let s = 0; s < sub; s++) {
        const ag1 = -(2 * zg * wg * vg + wg * wg * xg) // Kanai–Tajimi output
        vg += h * (-w - 2 * zg * wg * vg - wg * wg * xg)
        xg += h * vg
        a = ag1 - 2 * zf * wf * vf - wf * wf * xf // second-order high-pass removes long-period drift
        vf += h * a
        xf += h * vf
      }
      raw[i] = env * a
      disp[i] = env * xg
    }
  } else if (scenario === 'resonance') {
    const ramp = 3
    duration = ramp * 2 + Ds + 6
    strongStart = ramp
    strongEnd = ramp + Ds
    const n = Math.ceil(duration / dt)
    raw = new Float64Array(n)
    disp = new Float64Array(n)
    const w = 2 * Math.PI * f1
    for (let i = 0; i < n; i++) {
      const t = i * dt
      const env = t < ramp ? 0.5 - 0.5 * Math.cos((Math.PI * t) / ramp)
        : t < ramp + Ds ? 1
          : t < 2 * ramp + Ds ? 0.5 + 0.5 * Math.cos((Math.PI * (t - ramp - Ds)) / ramp) : 0
      raw[i] = env * Math.sin(w * t)
      disp[i] = -env * Math.sin(w * t)
    }
  } else {
    const fp = f1 * 0.92
    const t0 = 4
    const width = 1.1 / fp
    duration = t0 + 4 / fp + 8
    strongStart = t0 - width
    strongEnd = t0 + 1.5 * width
    const n = Math.ceil(duration / dt)
    raw = new Float64Array(n)
    disp = new Float64Array(n)
    let noiseLp = 0
    for (let i = 0; i < n; i++) {
      const t = i * dt
      const u = (t - t0) / width
      const env = Math.exp(-u * u)
      noiseLp += 0.15 * (gaussian(rand) - noiseLp)
      const tailEnv = Math.exp(-Math.abs(t - t0) / 3)
      raw[i] = env * Math.cos(2 * Math.PI * fp * (t - t0) + 0.4) + 0.12 * tailEnv * noiseLp
      disp[i] = -env * Math.cos(2 * Math.PI * fp * (t - t0) + 0.4)
    }
  }

  // scale to target PGA; normalise visual displacement to a sensible shake amplitude
  let peak = 1e-12, dpeak = 1e-12
  for (let i = 0; i < raw.length; i++) { peak = Math.max(peak, Math.abs(raw[i])); dpeak = Math.max(dpeak, Math.abs(disp[i])) }
  const ag = new Float32Array(raw.length)
  const dv = new Float32Array(raw.length)
  const visAmp = 0.25 + 1.6 * pga
  // steady resonance amplifies ~1/(2ζ); drive it gently so the comparison stays in the elastic range
  const target = scenario === 'resonance' ? pga * 0.12 : pga
  for (let i = 0; i < raw.length; i++) { ag[i] = (raw[i] / peak) * target * G; dv[i] = (disp[i] / dpeak) * visAmp }
  return { dt, ag, disp: dv, duration, pga: target, strongStart, strongEnd }
}

export function sampleRecord(arr: Float32Array, dt: number, t: number) {
  const x = t / dt
  const i = Math.floor(x)
  if (i < 0 || i >= arr.length - 1) return 0
  const f = x - i
  return arr[i] * (1 - f) + arr[i + 1] * f
}
