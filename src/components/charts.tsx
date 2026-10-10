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
    draw(hist.bare, BARE, 1.6, true)
    draw(hist.tmd, TMD, 2, true)
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
