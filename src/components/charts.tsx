import { useEffect, useRef } from 'react'
import type { SeismicEngine } from '../sim/engine'

const BARE = '#fb7185'
const TMD = '#38bdf8'
const QUAKE = '#fbbf24'
const GRID = 'rgba(148,163,184,0.10)'
const AXIS = 'rgba(148,163,184,0.55)'

function setup(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const r = canvas.getBoundingClientRect()
  const w = Math.max(1, Math.round(r.width * dpr))
  const h = Math.max(1, Math.round(r.height * dpr))
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
  const g = canvas.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { g, w: r.width, h: r.height }
}

function niceStep(range: number, target: number) {
  const raw = range / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag
}

function useRaf(cb: () => void) {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    let id = 0
    const loop = () => { ref.current(); id = requestAnimationFrame(loop) }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [])
}

/** Scrolling roof-displacement trace of both towers. */
export function LiveChart({ engine, windowSec = 16 }: { engine: SeismicEngine; windowSec?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const scale = useRef(0.1)
  useRaf(() => {
    const c = ref.current
    if (!c) return
    const { g, w, h } = setup(c)
    const hist = engine.hist
    const padL = 44, padR = 10, padT = 8, padB = 20
    const pw = w - padL - padR, ph = h - padT - padB
    const tEnd = Math.max(windowSec, engine.t)
    const tStart = tEnd - windowSec
    let i0 = 0
    while (i0 < hist.count && hist.t[i0] < tStart) i0++
    let mx = 0.02
    for (let i = i0; i < hist.count; i++) mx = Math.max(mx, Math.abs(hist.bare[i]), Math.abs(hist.tmd[i]))
    scale.current += (mx * 1.15 - scale.current) * (mx * 1.15 > scale.current ? 0.25 : 0.03)
    const ymax = scale.current
    const X = (t: number) => padL + ((t - tStart) / windowSec) * pw
    const Y = (v: number) => padT + ph / 2 - (v / ymax) * (ph / 2)

    g.clearRect(0, 0, w, h)
    g.font = '10px "JetBrains Mono", monospace'
    g.textBaseline = 'middle'
    const step = niceStep(ymax * 2, 4)
    for (let v = -Math.floor(ymax / step) * step; v <= ymax + 1e-9; v += step) {
      const y = Y(v)
      g.strokeStyle = Math.abs(v) < 1e-9 ? 'rgba(148,163,184,0.28)' : GRID
      g.beginPath(); g.moveTo(padL, y); g.lineTo(w - padR, y); g.stroke()
      g.fillStyle = AXIS; g.textAlign = 'right'
      g.fillText(`${v.toFixed(step < 0.1 ? 2 : 1)}`, padL - 6, y)
    }
    g.textAlign = 'center'
    const ts = niceStep(windowSec, 6)
    for (let t = Math.ceil(tStart / ts) * ts; t <= tEnd; t += ts) {
      if (t < 0) continue
      const x = X(t)
      g.strokeStyle = GRID
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke()
      g.fillStyle = AXIS
      g.fillText(`${t.toFixed(0)}s`, x, h - 8)
    }
    // strong-motion band
    const s0 = Math.max(tStart, engine.rec.strongStart), s1 = Math.min(tEnd, engine.rec.strongEnd)
    if (s1 > s0) { g.fillStyle = 'rgba(251,191,36,0.05)'; g.fillRect(X(s0), padT, X(s1) - X(s0), ph) }

    const draw = (arr: Float32Array, color: string, width: number, fill: boolean) => {
      if (hist.count - i0 < 2) return
      g.beginPath()
      for (let i = i0; i < hist.count; i++) {
        const x = X(hist.t[i]), y = Y(arr[i])
        i === i0 ? g.moveTo(x, y) : g.lineTo(x, y)
      }
      if (fill) {
        g.save()
        g.lineTo(X(hist.t[hist.count - 1]), Y(0)); g.lineTo(X(hist.t[i0]), Y(0)); g.closePath()
        g.fillStyle = color + '1c'; g.fill()
        g.restore()
        g.beginPath()
        for (let i = i0; i < hist.count; i++) { const x = X(hist.t[i]), y = Y(arr[i]); i === i0 ? g.moveTo(x, y) : g.lineTo(x, y) }
      }
      g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.stroke()
    }
    // rolling 3 s sway envelope (√2·RMS ≈ amplitude) of each tower; the band between them is the sway the TMD removes
    const W = 180 // samples (3 s at 60 Hz)
    const envB: number[] = [], envT: number[] = [], envX: number[] = []
    let sb = 0, st = 0
    const iStart = Math.max(0, i0 - W)
    for (let i = iStart; i < hist.count; i++) {
      sb += hist.bare[i] ** 2; st += hist.tmd[i] ** 2
      if (i - W >= iStart) { sb -= hist.bare[i - W] ** 2; st -= hist.tmd[i - W] ** 2 }
      if (i < i0) continue
      const k = Math.min(W, i - iStart + 1)
      envB.push(Math.SQRT2 * Math.sqrt(Math.max(0, sb) / k)); envT.push(Math.SQRT2 * Math.sqrt(Math.max(0, st) / k)); envX.push(X(hist.t[i]))
    }
    if (envX.length > 1) {
      for (const s of [1, -1]) {
        g.beginPath()
        envX.forEach((x, j) => (j ? g.lineTo(x, Y(s * envB[j])) : g.moveTo(x, Y(s * envB[j]))))
        for (let j = envX.length - 1; j >= 0; j--) g.lineTo(envX[j], Y(s * Math.min(envT[j], envB[j])))
        g.closePath()
        g.fillStyle = 'rgba(52,211,153,0.13)' // green = sway removed by the damper
        g.fill()
      }
    }
    draw(hist.bare, BARE, 1.6, true)
    draw(hist.tmd, TMD, 2.2, false)
    if (envX.length > 1) {
      g.setLineDash([5, 4])
      for (const [env, col] of [[envB, BARE], [envT, TMD]] as const) {
        for (const s of [1, -1]) {
          g.beginPath()
          envX.forEach((x, j) => (j ? g.lineTo(x, Y(s * env[j])) : g.moveTo(x, Y(s * env[j]))))
          g.strokeStyle = col; g.lineWidth = 1.3; g.stroke()
        }
      }
      g.setLineDash([])
      // live badge: reduction over the last 3 s
      const eb = envB[envB.length - 1], et = envT[envT.length - 1]
      if (eb > 0.01) {
        const red = (1 - et / eb) * 100
        const txt = red >= 0 ? `TMD cutting sway by ${red.toFixed(0)}%` : `TMD still building up (${red.toFixed(0)}%)`
        g.font = '700 11px Inter, sans-serif'
        const tw = g.measureText(txt).width
        const bx = w - padR - tw - 18, by = padT + 4
        g.fillStyle = red >= 20 ? 'rgba(16,185,129,0.92)' : 'rgba(30,41,59,0.92)'
        g.beginPath(); g.roundRect?.(bx, by, tw + 14, 20, 6); g.fill()
        g.fillStyle = red >= 20 ? '#04130d' : '#e2e8f0'; g.textAlign = 'left'; g.textBaseline = 'middle'
        g.fillText(txt, bx + 7, by + 10.5)
        g.font = '10px "JetBrains Mono", monospace'
      }
    }
    g.lineWidth = 1
    if (hist.count) {
      const i = hist.count - 1
      for (const [arr, col] of [[hist.bare, BARE], [hist.tmd, TMD]] as const) {
        g.fillStyle = col
        g.beginPath(); g.arc(X(hist.t[i]), Y(arr[i]), 3, 0, Math.PI * 2); g.fill()
      }
    }
  })
  return <canvas ref={ref} className="h-full w-full" />
}

/** Whole ground-acceleration record with a playhead. */
export function Seismogram({ engine }: { engine: SeismicEngine }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useRaf(() => {
    const c = ref.current
    if (!c) return
    const { g, w, h } = setup(c)
    const rec = engine.rec
    const total = engine.endTime
    const n = rec.ag.length
    const pga = Math.max(rec.pga * 9.81, 1e-6)
    g.clearRect(0, 0, w, h)
    const mid = h / 2
    const px = Math.max(1, Math.floor(w))
    const playX = (engine.t / total) * w
    // min/max envelope per pixel column
    for (let x = 0; x < px; x++) {
      const t0 = (x / w) * total, t1 = ((x + 1) / w) * total
      const i0 = Math.floor(t0 / rec.dt), i1 = Math.min(n, Math.ceil(t1 / rec.dt))
      let lo = 0, hi = 0
      for (let i = i0; i < i1; i++) { const v = rec.ag[i] / pga; if (v < lo) lo = v; if (v > hi) hi = v }
      if (i1 <= i0) continue
      g.fillStyle = x < playX ? QUAKE : 'rgba(251,191,36,0.28)'
      g.fillRect(x, mid - hi * (h / 2 - 3), 1, Math.max(1, (hi - lo) * (h / 2 - 3)))
    }
    g.fillStyle = '#fff'
    g.fillRect(playX - 1, 0, 2, h)
  })
  return <canvas ref={ref} className="h-full w-full" />
}

/** Static frequency-response plot. */
export function FrfChart(props: { freqs: Float64Array; bare: Float64Array; tmd: Float64Array; f1: number; fd?: number; tmdOn: boolean; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const draw = () => {
      const c = ref.current
      if (!c) return
      const { g, w, h } = setup(c)
      const { freqs, bare, tmd } = props
      const padL = 40, padR = 12, padT = 12, padB = 28
      const pw = w - padL - padR, ph = h - padT - padB
      let ymax = 1
      for (let i = 0; i < freqs.length; i++) ymax = Math.max(ymax, bare[i])
      ymax *= 1.08
      const f0 = freqs[0], f1 = freqs[freqs.length - 1]
      const X = (f: number) => padL + ((f - f0) / (f1 - f0)) * pw
      const Y = (v: number) => padT + ph - (v / ymax) * ph
      g.clearRect(0, 0, w, h)
      g.font = '10px "JetBrains Mono", monospace'
      g.textBaseline = 'middle'
      const ys = niceStep(ymax, 4)
      for (let v = 0; v <= ymax; v += ys) {
        g.strokeStyle = GRID; g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(w - padR, Y(v)); g.stroke()
        g.fillStyle = AXIS; g.textAlign = 'right'; g.fillText(v.toFixed(0) + '×', padL - 6, Y(v))
      }
      const xs = niceStep(f1 - f0, 6)
      g.textAlign = 'center'
      for (let f = Math.ceil(f0 / xs) * xs; f <= f1 + 1e-9; f += xs) {
        g.strokeStyle = GRID; g.beginPath(); g.moveTo(X(f), padT); g.lineTo(X(f), padT + ph); g.stroke()
        g.fillStyle = AXIS; g.fillText(f.toFixed(2), X(f), h - 16)
      }
      g.fillText('ground shaking frequency (Hz)', padL + pw / 2, h - 4)
      // natural frequency marker
      g.setLineDash([4, 4]); g.strokeStyle = 'rgba(251,113,133,0.5)'
      g.beginPath(); g.moveTo(X(props.f1), padT); g.lineTo(X(props.f1), padT + ph); g.stroke()
      g.setLineDash([])
      const line = (arr: Float64Array, col: string, lw: number) => {
        g.beginPath()
        for (let i = 0; i < freqs.length; i++) { const x = X(freqs[i]), y = Y(arr[i]); i ? g.lineTo(x, y) : g.moveTo(x, y) }
        g.strokeStyle = col; g.lineWidth = lw; g.stroke()
        g.lineTo(X(f1), Y(0)); g.lineTo(X(f0), Y(0)); g.closePath(); g.fillStyle = col + '18'; g.fill()
        g.lineWidth = 1
      }
      line(bare, BARE, 1.8)
      if (props.tmdOn) line(tmd, TMD, 2.2)
      // peak labels
      let ib = 0, it = 0
      for (let i = 0; i < freqs.length; i++) { if (bare[i] > bare[ib]) ib = i; if (tmd[i] > tmd[it]) it = i }
      g.font = '600 11px Inter, sans-serif'
      g.textAlign = 'left'
      g.fillStyle = BARE; g.fillText(`${bare[ib].toFixed(1)}× peak`, Math.min(X(freqs[ib]) + 8, w - 90), Y(bare[ib]) + 4)
      if (props.tmdOn) { g.fillStyle = TMD; g.fillText(`${tmd[it].toFixed(1)}×`, Math.min(X(freqs[it]) + 6, w - 40), Y(tmd[it]) - 9) }
    }
    draw()
    const ro = new ResizeObserver(draw)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [props])
  return <canvas ref={ref} className="w-full" style={{ height: props.height ?? 220 }} />
}

/** Generic two-trace live plot for sensor data (values supplied by callback). */
export function SensorChart(props: { getData: () => { t: number[]; a: number[]; b: number[] }; unit: string; windowSec?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const scale = useRef(0.1)
  const getData = useRef(props.getData)
  getData.current = props.getData
  useRaf(() => {
    const c = ref.current
    if (!c) return
    const { g, w, h } = setup(c)
    const { t, a, b } = getData.current()
    const win = props.windowSec ?? 12
    const padL = 48, padR = 10, padT = 10, padB = 22
    const pw = w - padL - padR, ph = h - padT - padB
    const tEnd = t.length ? Math.max(win, t[t.length - 1]) : win
    const tStart = tEnd - win
    let i0 = 0
    while (i0 < t.length && t[i0] < tStart) i0++
    let mx = 0.01
    for (let i = i0; i < t.length; i++) mx = Math.max(mx, Math.abs(a[i]), Number.isNaN(b[i]) ? 0 : Math.abs(b[i]))
    scale.current += (mx * 1.15 - scale.current) * (mx * 1.15 > scale.current ? 0.3 : 0.02)
    const ymax = scale.current
    const X = (v: number) => padL + ((v - tStart) / win) * pw
    const Y = (v: number) => padT + ph / 2 - (v / ymax) * (ph / 2)
    g.clearRect(0, 0, w, h)
    g.font = '10px "JetBrains Mono", monospace'
    g.textBaseline = 'middle'
    const step = niceStep(ymax * 2, 4)
    for (let v = -Math.floor(ymax / step) * step; v <= ymax + 1e-9; v += step) {
      g.strokeStyle = Math.abs(v) < 1e-9 ? 'rgba(148,163,184,0.28)' : GRID
      g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(w - padR, Y(v)); g.stroke()
      g.fillStyle = AXIS; g.textAlign = 'right'
      g.fillText(v.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1), padL - 6, Y(v))
    }
    g.textAlign = 'left'; g.fillText(props.unit, 4, padT + 2)
    const line = (arr: number[], col: string, lw: number) => {
      if (t.length - i0 < 2) return
      g.beginPath()
      let pen = false
      for (let i = i0; i < t.length; i++) {
        if (Number.isNaN(arr[i])) { pen = false; continue } // single-sensor gaps
        const x = X(t[i]), y = Y(arr[i])
        pen ? g.lineTo(x, y) : g.moveTo(x, y)
        pen = true
      }
      g.strokeStyle = col; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke(); g.lineWidth = 1
    }
    line(a, BARE, 1.5)
    line(b, TMD, 2)
  })
  return <canvas ref={ref} className="h-full w-full" />
}

export interface AlertTrace { t: ArrayLike<number>; v: ArrayLike<number>; n: number; tNow: number }
const ALERT_BANDS = [
  { g: 0.02, color: '#fbbf24', name: 'Advisory' },
  { g: 0.06, color: '#fb923c', name: 'Warning' },
  { g: 0.15, color: '#f43f5e', name: 'Severe' },
]

/**
 * Seismic trace with alert thresholds. The chart runs the same envelope detector as the alert
 * monitor: where the shaking envelope crosses the threshold the trace turns red, the alert span is
 * shaded, and an "ALERT" flag marks the moment of detection.
 */
export function AlertChart({ getTrace, threshold, windowSec = 20, unitLabel = 'g' }: { getTrace: () => AlertTrace; threshold: number; windowSec?: number; unitLabel?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const scale = useRef(0.05)
  const getRef = useRef(getTrace)
  getRef.current = getTrace
  const thrRef = useRef(threshold)
  thrRef.current = threshold
  useRaf(() => {
    const c = ref.current
    if (!c) return
    const { g, w, h } = setup(c)
    const { t, v, n, tNow } = getRef.current()
    const thr = thrRef.current
    const padL = 50, padR = 92, padT = 22, padB = 22
    const pw = w - padL - padR, ph = h - padT - padB
    const tEnd = Math.max(windowSec, tNow)
    const tStart = tEnd - windowSec
    let i0 = 0
    while (i0 < n && t[i0] < tStart - 2) i0++ // a little lead-in so the envelope is warm at the left edge
    let mx = thr * 1.6
    for (let i = i0; i < n; i++) if (t[i] >= tStart) mx = Math.max(mx, Math.abs(v[i]))
    scale.current += (mx * 1.12 - scale.current) * (mx * 1.12 > scale.current ? 0.3 : 0.03)
    const ymax = scale.current
    const X = (tt: number) => padL + ((tt - tStart) / windowSec) * pw
    const Y = (vv: number) => padT + ph / 2 - (vv / ymax) * (ph / 2)
    g.clearRect(0, 0, w, h)
    g.font = '10px "JetBrains Mono", monospace'
    g.textBaseline = 'middle'

    // envelope detector → alert spans + detection instants
    const spans: [number, number][] = []
    const flags: number[] = []
    let env = 0, on = false, lastHot = -1e9, spanStart = 0, prevT = n > i0 ? t[i0] : 0
    for (let i = i0; i < n; i++) {
      const dt = Math.max(0, t[i] - prevT); prevT = t[i]
      env = Math.max(Math.abs(v[i]), env * Math.exp(-dt / 0.9))
      if (env >= thr) { lastHot = t[i]; if (!on) { on = true; spanStart = t[i]; flags.push(t[i]) } }
      if (on && t[i] - lastHot > 4) { on = false; spans.push([spanStart, t[i]]) }
    }
    if (on) spans.push([spanStart, n ? t[n - 1] : tNow])
    for (const [a, b] of spans) {
      const x0 = Math.max(padL, X(a)), x1 = Math.min(padL + pw, X(b))
      if (x1 <= x0) continue
      const grd = g.createLinearGradient(0, padT, 0, padT + ph)
      grd.addColorStop(0, 'rgba(244,63,94,0.16)'); grd.addColorStop(0.5, 'rgba(244,63,94,0.06)'); grd.addColorStop(1, 'rgba(244,63,94,0.16)')
      g.fillStyle = grd
      g.fillRect(x0, padT, x1 - x0, ph)
    }

    // grid + threshold bands
    g.strokeStyle = 'rgba(148,163,184,0.28)'
    g.beginPath(); g.moveTo(padL, Y(0)); g.lineTo(padL + pw, Y(0)); g.stroke()
    g.fillStyle = AXIS; g.textAlign = 'right'
    g.fillText(`+${ymax.toFixed(2)} ${unitLabel}`, padL - 6, Y(ymax) + 4); g.fillText('0', padL - 6, Y(0)); g.fillText(`−${ymax.toFixed(2)} ${unitLabel}`, padL - 6, Y(-ymax) - 4)
    g.textAlign = 'left'
    for (const b of ALERT_BANDS) {
      if (b.g > ymax) continue
      const armed = Math.abs(b.g - thr) < 1e-9
      g.setLineDash(armed ? [] : [4, 4])
      g.strokeStyle = b.color + (armed ? 'cc' : '66')
      g.lineWidth = armed ? 1.5 : 1
      for (const s of [1, -1]) { g.beginPath(); g.moveTo(padL, Y(s * b.g)); g.lineTo(padL + pw, Y(s * b.g)); g.stroke() }
      g.setLineDash([]); g.lineWidth = 1
      g.fillStyle = b.color
      g.font = `${armed ? '700 ' : ''}10px Inter, sans-serif`
      g.fillText(`${armed ? '▶ ' : ''}${b.name}`, padL + pw + 6, Y(b.g) - 6)
      g.fillText(`${b.g} ${unitLabel}`, padL + pw + 6, Y(b.g) + 6)
    }
    g.font = '10px "JetBrains Mono", monospace'

    // time axis
    g.textAlign = 'center'; g.fillStyle = AXIS
    const ts = niceStep(windowSec, 6)
    for (let tt = Math.ceil(tStart / ts) * ts; tt <= tEnd; tt += ts) if (tt >= 0) g.fillText(`${tt.toFixed(0)}s`, X(tt), h - 8)

    // trace: amber when quiet, red inside alert spans
    g.save(); g.beginPath(); g.rect(padL, padT, pw, ph); g.clip()
    const inSpan = (tt: number) => spans.some(([a, b]) => tt >= a && tt <= b)
    let prevX = 0, prevY = 0, first = true
    for (let i = i0; i < n; i++) {
      if (t[i] < tStart) continue
      const x = X(t[i]), y = Y(v[i])
      if (!first) {
        g.strokeStyle = inSpan(t[i]) ? '#f43f5e' : QUAKE
        g.lineWidth = inSpan(t[i]) ? 1.8 : 1.4
        g.beginPath(); g.moveTo(prevX, prevY); g.lineTo(x, y); g.stroke()
      }
      prevX = x; prevY = y; first = false
    }
    g.restore(); g.lineWidth = 1

    // detection flags
    for (const f of flags) {
      if (f < tStart) continue
      const x = X(f)
      g.strokeStyle = '#f43f5e'; g.lineWidth = 2
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + ph); g.stroke(); g.lineWidth = 1
      g.fillStyle = '#f43f5e'
      g.beginPath(); g.roundRect?.(x - 1, padT - 18, 66, 16, 3); g.fill()
      g.fillStyle = '#fff'; g.font = '700 10px Inter, sans-serif'; g.textAlign = 'left'
      g.fillText(`⚠ ALERT ${f.toFixed(1)}s`, x + 4, padT - 10)
      g.font = '10px "JetBrains Mono", monospace'
    }
    // live head
    if (n > 0 && t[n - 1] >= tStart) {
      g.fillStyle = on ? '#f43f5e' : QUAKE
      g.beginPath(); g.arc(X(t[n - 1]), Y(v[n - 1]), 3.5, 0, Math.PI * 2); g.fill()
    }
  })
  return <canvas ref={ref} className="h-full w-full" />
}
