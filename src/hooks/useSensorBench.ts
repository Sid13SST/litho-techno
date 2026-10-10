import { useCallback, useEffect, useRef, useState } from 'react'
import { Chain, G, optimalTmd } from '../sim/physics'
import { gaussian, mulberry32, pgaFromMagnitude } from '../sim/ground'

/* Minimal Web Serial typings (not yet in lib.dom) */
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream<Uint8Array> | null
}
declare global {
  interface Navigator { serial?: { requestPort(): Promise<SerialPortLike> } }
}

export type Unit = 'g' | 'ms2' | 'deg'
export const UNIT_LABEL: Record<Unit, string> = { g: 'g', ms2: 'm/s²', deg: '°' }

export interface TestResult {
  magnitude: number
  duration: number
  samples: number
  peakA: number; peakB: number
  p2pA: number; p2pB: number
  avgA: number; avgB: number
  date: number
  source: 'arduino' | 'demo'
}

const STORE_KEY = 'seismoshield-bench-v1'
const WINDOW = 30 // s of live history kept

/** Parse one serial line → accelerations in g. Accepts "a,b", "a b", JSON and raw MPU counts. */
export function parseLine(line: string): { a: number; b: number | null } | null {
  const s = line.trim()
  if (!s || s.startsWith('#') || s.startsWith('//')) return null
  if (s.startsWith('{') && s.endsWith('}')) {
    try {
      const o = JSON.parse(s)
      const a = o.without ?? o.b1 ?? o.sensor1 ?? o.a1 ?? o.x
      const b = o.with ?? o.b2 ?? o.sensor2 ?? o.a2 ?? o.y
      if (typeof a === 'number') return { a, b: typeof b === 'number' ? b : null }
    } catch { /* fall through to numeric parse */ }
  }
  const nums = s.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g)?.map(Number).filter((n) => !Number.isNaN(n))
  if (!nums?.length) return null
  const v = nums.some((n) => Math.abs(n) > 40) ? nums.map((n) => n / 16384) : nums // raw ±2 g counts
  if (v.length === 1) return { a: v[0], b: null }
  if (v.length === 3 || v.length >= 6) return { a: Math.hypot(v[0], v[1]), b: null } // single MPU ax,ay,az(,gx,gy,gz)
  return { a: v[0], b: v[1] }
}

export function convert(vg: number, unit: Unit) {
  if (unit === 'ms2') return vg * G
  if (unit === 'deg') return (Math.asin(Math.max(-1, Math.min(1, vg))) * 180) / Math.PI
  return vg
}

/** Two small physical models on a virtual shake table: 1-story frame with and without a TMD. */
function makeDemoRig() {
  const f = 2.2, zeta = 0.015, mu = 0.08
  const w = 2 * Math.PI * f
  const m = 1, k = m * w * w, c = 2 * zeta * m * w
  const bare = new Chain(1)
  bare.m[0] = m; bare.k[0] = k; bare.c[0] = c
  const tmd = new Chain(2)
  tmd.m[0] = m; tmd.k[0] = k; tmd.c[0] = c
  const o = optimalTmd(mu)
  const md = mu * m, wd = w * o.freqRatio
  tmd.m[1] = md; tmd.k[1] = md * wd * wd; tmd.c[1] = 2 * o.zeta * md * wd
  const accB = new Float64Array(1), accT = new Float64Array(2)
  const rand = mulberry32(42)
  let xg = 0, vg = 0
  return {
    /** advance dt seconds; amp = PGA in g (0 = ambient); returns absolute roof accelerations (g) */
    step(dt: number, amp: number) {
      const sub = 10, h = dt / sub
      const wg = w * 1.02, zg = 0.25
      let ag = 0
      for (let i = 0; i < sub; i++) {
        const noise = gaussian(rand) / Math.sqrt(h)
        ag = -(2 * zg * wg * vg + wg * wg * xg)
        vg += h * (-noise - 2 * zg * wg * vg - wg * wg * xg)
        xg += h * vg
        const a = ag * amp * 0.035 * G // scaled for a desktop-size shake table
        bare.step(h, a, a, a)
        tmd.step(h, a, a, a)
        ag = a
      }
      bare.accel(bare.x, bare.v, ag, accB)
      tmd.accel(tmd.x, tmd.v, ag, accT)
      const n1 = () => gaussian(rand) * 0.0015 // sensor noise
      return { a: (accB[0] + ag) / G + n1(), b: (accT[0] + ag) / G + n1() }
    },
  }
}

export function useSensorBench() {
  const [connected, setConnected] = useState(false)
  const [demo, setDemo] = useState(false) // simulated data only when the user asks for it
  const [recording, setRecording] = useState(false)
  const [unit, setUnit] = useState<Unit>('g')
  const [baud, setBaud] = useState(115200)
  const [magnitude, setMagnitude] = useState(6)
  const [error, setError] = useState<string | null>(null)
  const [rate, setRate] = useState(0)
  const [dual, setDual] = useState(true)
  const [lastLine, setLastLine] = useState('')
  const [live, setLive] = useState({ a: 0, b: 0 })
  const [results, setResults] = useState<Record<string, TestResult>>(() => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') } catch { return {} }
  })

  const buf = useRef({ t: [] as number[], a: [] as number[], b: [] as number[] })
  const rec = useRef({ a: [] as number[], b: [] as number[], start: 0 })
  const tare = useRef({ a: 0, b: 0 })
  const lastRaw = useRef({ a: 0, b: 0 })
  const t0 = useRef(performance.now())
  const port = useRef<SerialPortLike | null>(null)
  const reader = useRef<ReadableStreamDefaultReader<string> | null>(null)
  const recordingRef = useRef(false)
  const magRef = useRef(magnitude)
  magRef.current = magnitude
  const rateCount = useRef({ n: 0, since: performance.now() })
  const source = useRef<'arduino' | 'demo'>('demo')

  const ingest = useCallback((a: number, b: number | null, at?: number) => {
    lastRaw.current = { a, b: b ?? 0 }
    const va = a - tare.current.a
    const vb = b === null ? NaN : b - tare.current.b
    const t = at ?? (performance.now() - t0.current) / 1000
    const B = buf.current
    B.t.push(t); B.a.push(va); B.b.push(vb)
    while (B.t.length && B.t[0] < t - WINDOW) { B.t.shift(); B.a.shift(); B.b.shift() }
    if (recordingRef.current) { rec.current.a.push(va); rec.current.b.push(vb) }
    rateCount.current.n++
  }, [])

  // demo generator
  useEffect(() => {
    if (!demo || connected) return
    source.current = 'demo'
    setDual(true)
    const rig = makeDemoRig()
    const dt = 0.01
    let last = performance.now()
    let carry = 0
    let clock = (performance.now() - t0.current) / 1000 // simulated sample clock, so batched samples stay evenly spaced
    const id = setInterval(() => {
      const now = performance.now()
      carry += Math.min(0.5, (now - last) / 1000) // advance by real elapsed time, even if the timer is throttled
      last = now
      const amp = recordingRef.current ? pgaFromMagnitude(magRef.current) : 0 // table is still until a test starts
      const real = (now - t0.current) / 1000
      if (Math.abs(real - clock - carry) > 1) clock = real - carry // resync after long throttling
      for (; carry >= dt; carry -= dt) {
        clock += dt
        const r = rig.step(dt, amp)
        ingest(r.a, r.b, clock)
      }
      setLastLine(`${(lastRaw.current.a).toFixed(3)},${(lastRaw.current.b).toFixed(3)}`)
    }, 20)
    return () => { clearInterval(id); buf.current = { t: [], a: [], b: [] }; setLastLine(''); setLive({ a: 0, b: 0 }) }
  }, [demo, connected, ingest])

  // UI refresh + sample-rate meter
  useEffect(() => {
    const id = setInterval(() => {
      const B = buf.current
      const n = B.a.length
      if (n) setLive({ a: B.a[n - 1], b: B.b[n - 1] })
      const now = performance.now()
      const rc = rateCount.current
      if (now - rc.since > 1000) { setRate(Math.round((rc.n * 1000) / (now - rc.since))); rc.n = 0; rc.since = now }
    }, 80)
    return () => clearInterval(id)
  }, [])

  const readLoop = useCallback(async (p: SerialPortLike) => {
    if (!p.readable) return
    const decoder = new TextDecoderStream()
    const done = p.readable.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => {})
    const r = decoder.readable.getReader()
    reader.current = r
    let pending = ''
    let seenDual = false
    try {
      for (;;) {
        const { value, done: end } = await r.read()
        if (end) break
        pending += value
        let nl: number
        while ((nl = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, nl).trim()
          pending = pending.slice(nl + 1)
          if (!line) continue
          setLastLine(line)
          const v = parseLine(line)
          if (!v) continue
          if (v.b !== null && !seenDual) { seenDual = true; setDual(true) }
          if (v.b === null && seenDual === false) setDual(false)
          ingest(v.a, v.b)
        }
      }
    } catch { /* port closed */ } finally {
      r.releaseLock()
      await done
    }
  }, [ingest])

  const connect = useCallback(async () => {
    setError(null)
    if (!navigator.serial) {
      setError('Web Serial is not available in this browser. Use Chrome, Edge or Opera on desktop, or keep using the demo rig.')
      return
    }
    try {
      const p = await navigator.serial.requestPort()
      await p.open({ baudRate: baud })
      port.current = p
      source.current = 'arduino'
      buf.current = { t: [], a: [], b: [] }
      t0.current = performance.now()
      setConnected(true)
      setDemo(false)
      readLoop(p)
    } catch (e) {
      if (e instanceof Error && e.name !== 'NotFoundError') setError(e.message)
    }
  }, [baud, readLoop])

  const disconnect = useCallback(async () => {
    try { await reader.current?.cancel() } catch { /* ignore */ }
    try { await port.current?.close() } catch { /* ignore */ }
    port.current = null
    setConnected(false)
  }, [])

  useEffect(() => () => { void disconnect() }, [disconnect])

  const start = useCallback(() => {
    rec.current = { a: [], b: [], start: performance.now() }
    recordingRef.current = true
    setRecording(true)
  }, [])

  const stop = useCallback(() => {
    recordingRef.current = false
    setRecording(false)
    const { a, b, start: s } = rec.current
    if (a.length < 10) return
    const bb = b.filter((x) => !Number.isNaN(x))
    const stats = (arr: number[]) => arr.length ? {
      peak: Math.max(...arr.map(Math.abs)),
      p2p: Math.max(...arr) - Math.min(...arr),
      avg: arr.reduce((acc, x) => acc + Math.abs(x), 0) / arr.length,
    } : { peak: 0, p2p: 0, avg: 0 }
    const A = stats(a), B = stats(bb)
    const res: TestResult = {
      magnitude: magRef.current,
      duration: (performance.now() - s) / 1000,
      samples: a.length,
      peakA: A.peak, peakB: B.peak, p2pA: A.p2p, p2pB: B.p2p, avgA: A.avg, avgB: B.avg,
      date: Date.now(),
      source: source.current,
    }
    setResults((prev) => {
      const next = { ...prev, [magRef.current.toFixed(1)]: res }
      try { localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
      return next
    })
  }, [])

  const clearResults = useCallback(() => {
    setResults({})
    try { localStorage.removeItem(STORE_KEY) } catch { /* ignore */ }
  }, [])

  /** latest tared sample for the 3D view; b is NaN with a single sensor */
  const activeRef = useRef(false)
  activeRef.current = connected || demo
  const sample = useCallback(() => {
    const B = buf.current
    const n = B.a.length
    return { a: n ? B.a[n - 1] : 0, b: n ? B.b[n - 1] : 0, active: activeRef.current && n > 0 }
  }, [])

  const doTare = useCallback(() => { tare.current = { ...lastRaw.current } }, [])
  const resetTare = useCallback(() => { tare.current = { a: 0, b: 0 } }, [])
  const clearGraph = useCallback(() => { buf.current = { t: [], a: [], b: [] }; t0.current = performance.now() }, [])

  return {
    connected, demo, setDemo, recording, unit, setUnit, baud, setBaud, magnitude, setMagnitude,
    error, rate, dual, lastLine, live, results, buf, sample,
    connect, disconnect, start, stop, clearResults, doTare, resetTare, clearGraph,
  }
}
