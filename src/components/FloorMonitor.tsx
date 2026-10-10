import { useEffect, useRef } from 'react'
import { Building, HeartPulse, Layers, ShieldAlert } from 'lucide-react'
import { DAMAGE_STATES, assessCondition, damageState, type SeismicEngine, type TowerMetrics } from '../sim/engine'
import type { Chain } from '../sim/physics'
import { cx } from './ui'

const BARE = '#fb7185'
const TMD = '#38bdf8'

/** Floor-by-floor response: deformed shape, per-floor table and condition / stability cards. */
export default function FloorMonitor({ engine }: { engine: SeismicEngine }) {
  return (
    <div className="panel p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="label flex items-center gap-2"><Layers className="h-3.5 w-3.5" />Floor-by-floor response &amp; structural condition</div>
        <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-slate-400">
          {DAMAGE_STATES.map((d) => (
            <span key={d.label} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: d.color }} />{d.label}</span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ConditionCard kind="bare" m={engine.mBare} />
        <ConditionCard kind="tmd" m={engine.mTmd} compare={engine.mBare} disabled={!engine.p.tmdEnabled} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)]">
        <div className="rounded-xl bg-ink-950/50 p-3 ring-1 ring-white/5">
          <div className="mb-1 flex items-center justify-between text-[11.5px] text-slate-400">
            <span className="font-semibold text-slate-300">Deformed shape</span>
            <span>line = now · band = peak envelope</span>
          </div>
          <div className="h-[420px]"><ProfileChart engine={engine} /></div>
        </div>
        <FloorTable engine={engine} />
      </div>
    </div>
  )
}

function ConditionCard({ kind, m, compare, disabled }: { kind: 'bare' | 'tmd'; m: TowerMetrics; compare?: TowerMetrics; disabled?: boolean }) {
  const c = assessCondition(m)
  const color = kind === 'bare' ? 'text-bare' : 'text-tmd'
  const statusTone = c.status === 'Stable' ? 'text-emerald-300 bg-emerald-400/10 ring-emerald-400/25' : c.status === 'Marginal' ? 'text-amber-300 bg-amber-400/10 ring-amber-400/25' : 'text-rose-300 bg-rose-500/10 ring-rose-400/30'
  const started = m.samples > 0
  const healthDelta = compare ? c.health - assessCondition(compare).health : 0
  return (
    <div className={cx('rounded-xl bg-ink-950/50 p-4 ring-1', kind === 'bare' ? 'ring-rose-400/15' : 'ring-sky-400/20', disabled && 'opacity-50')}>
      <div className="flex items-center justify-between gap-2">
        <div className={cx('flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider', color)}>
          <Building className="h-4 w-4" />{kind === 'bare' ? 'Conventional tower' : 'Tower with TMD'}
        </div>
        <span className={cx('rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset', started ? statusTone : 'bg-white/5 text-slate-400 ring-white/10')}>
          {started ? c.status : 'Awaiting test'}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Gauge icon={<HeartPulse className="h-3.5 w-3.5" />} label="Structural health" value={c.health} sub={compare && started && Math.abs(healthDelta) >= 0.5 ? <span className={healthDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{healthDelta >= 0 ? '+' : ''}{healthDelta.toFixed(0)} pts</span> : 'damage-weighted'} />
        <Gauge icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Stability margin" value={c.stability} sub="to 2.5 % drift" />
        <div>
          <div className="text-[10.5px] uppercase tracking-wider text-slate-500">P-Δ index θ</div>
          <div className={cx('num mt-1 text-xl font-bold', c.theta > 0.25 ? 'text-rose-400' : c.theta > 0.1 ? 'text-amber-300' : 'text-white')}>{c.theta.toFixed(3)}</div>
          <div className="text-[10.5px] text-slate-500">limit 0.10 (ASCE 7)</div>
        </div>
      </div>
      {/* damage distribution across floors */}
      <div className="mt-3">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-white/5">
          {c.counts.map((n, i) => n > 0 && <div key={i} style={{ width: `${(n / m.storyPeakIdr.length) * 100}%`, background: DAMAGE_STATES[i].color }} title={`${n} floors: ${DAMAGE_STATES[i].label}`} />)}
        </div>
        <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-[11px] text-slate-400">
          <span>{c.counts.slice(2).reduce((a, b) => a + b, 0)} of {m.storyPeakIdr.length} floors with moderate+ damage</span>
          {started && m.peakIdr > 0.003 && <span>worst: floor <span className="num text-slate-200">{c.worstFloor}</span> ({(m.storyPeakIdr[c.worstFloor - 1] * 100).toFixed(2)}%)</span>}
        </div>
      </div>
    </div>
  )
}

function Gauge({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub: React.ReactNode }) {
  const col = value >= 80 ? '#34d399' : value >= 50 ? '#fbbf24' : '#f43f5e'
  return (
    <div>
      <div className="flex items-center gap-1 text-[10.5px] uppercase tracking-wider text-slate-500">{icon}{label}</div>
      <div className="num mt-1 text-xl font-bold" style={{ color: col }}>{value.toFixed(0)}%</div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full transition-all duration-300" style={{ width: `${value}%`, background: col }} /></div>
      <div className="mt-1 text-[10.5px] text-slate-500">{sub}</div>
    </div>
  )
}

/** Vertical deformed-shape plot: x = floor displacement, y = height. */
function ProfileChart({ engine }: { engine: SeismicEngine }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const scale = useRef(0.1)
  useEffect(() => {
    let id = 0
    const draw = () => {
      id = requestAnimationFrame(draw)
      const c = ref.current
      if (!c) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const r = c.getBoundingClientRect()
      if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr) }
      const g = c.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const w = r.width, h = r.height
      const n = engine.p.stories
      const padL = 30, padR = 10, padT = 10, padB = 24
      const pw = w - padL - padR, ph = h - padT - padB
      let mx = 0.02
      for (let j = 0; j < n; j++) mx = Math.max(mx, engine.mBare.floorPeakDisp[j], engine.mTmd.floorPeakDisp[j])
      scale.current += (mx * 1.1 - scale.current) * (mx * 1.1 > scale.current ? 0.3 : 0.05)
      const xm = scale.current
      const X = (v: number) => padL + pw / 2 + (v / xm) * (pw / 2)
      const Y = (floor: number) => padT + ph - (floor / n) * ph
      g.clearRect(0, 0, w, h)
      g.font = '10px "JetBrains Mono", monospace'
      g.textBaseline = 'middle'
      // floor gridlines
      for (let f = 0; f <= n; f++) {
        g.strokeStyle = f % 5 === 0 ? 'rgba(148,163,184,0.14)' : 'rgba(148,163,184,0.05)'
        g.beginPath(); g.moveTo(padL, Y(f)); g.lineTo(w - padR, Y(f)); g.stroke()
        if (f % 5 === 0) { g.fillStyle = 'rgba(148,163,184,0.6)'; g.textAlign = 'right'; g.fillText(f === 0 ? 'G' : `${f}`, padL - 6, Y(f)) }
      }
      g.strokeStyle = 'rgba(148,163,184,0.3)'
      g.beginPath(); g.moveTo(X(0), padT); g.lineTo(X(0), padT + ph); g.stroke()
      g.textAlign = 'center'; g.fillStyle = 'rgba(148,163,184,0.6)'
      g.fillText(`−${xm.toFixed(2)} m`, padL + 22, h - 8); g.fillText(`+${xm.toFixed(2)} m`, w - padR - 22, h - 8); g.fillText('0', X(0), h - 8)

      const envelope = (m: TowerMetrics, col: string) => {
        g.beginPath()
        g.moveTo(X(0), Y(0))
        for (let j = 0; j < n; j++) g.lineTo(X(m.floorPeakDisp[j]), Y(j + 1))
        for (let j = n - 1; j >= 0; j--) g.lineTo(X(-m.floorPeakDisp[j]), Y(j + 1))
        g.closePath()
        g.fillStyle = col + '14'; g.fill()
        g.strokeStyle = col + '40'; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([])
      }
      const shape = (ch: Chain, m: TowerMetrics, col: string) => {
        g.beginPath(); g.moveTo(X(0), Y(0))
        for (let j = 0; j < n; j++) g.lineTo(X(ch.x[j]), Y(j + 1))
        g.strokeStyle = col; g.lineWidth = 2.2; g.lineJoin = 'round'; g.stroke(); g.lineWidth = 1
        for (let j = 0; j < n; j++) {
          g.fillStyle = DAMAGE_STATES[damageState(m.storyPeakIdr[j])].color
          g.beginPath(); g.arc(X(ch.x[j]), Y(j + 1), 2.6, 0, Math.PI * 2); g.fill()
        }
      }
      envelope(engine.mBare, BARE)
      if (engine.p.tmdEnabled) envelope(engine.mTmd, TMD)
      shape(engine.bare, engine.mBare, BARE)
      if (engine.p.tmdEnabled) shape(engine.tmd, engine.mTmd, TMD)
    }
    id = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(id)
  }, [engine])
  return <canvas ref={ref} className="h-full w-full" />
}

function FloorTable({ engine }: { engine: SeismicEngine }) {
  const n = engine.p.stories
  const h = engine.p.storyHeight
  let maxPeak = 0.02
  for (let j = 0; j < n; j++) maxPeak = Math.max(maxPeak, engine.mBare.floorPeakDisp[j], engine.mTmd.floorPeakDisp[j])
  const rows = Array.from({ length: n }, (_, k) => n - 1 - k) // roof first
  const cell = (ch: Chain, m: TowerMetrics, j: number, col: string) => {
    const x = ch.x[j]
    const idr = Math.abs(x - (j > 0 ? ch.x[j - 1] : 0)) / h
    const ds = damageState(m.storyPeakIdr[j])
    const pct = Math.min(50, (Math.abs(x) / maxPeak) * 50)
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_52px_46px] items-center gap-2">
        <div className="relative h-2 rounded-full bg-white/[0.04]">
          <div className="absolute inset-y-0 left-1/2 w-px bg-white/15" />
          <div className="absolute inset-y-0 rounded-full" style={{ background: col, opacity: 0.85, left: x >= 0 ? '50%' : `${50 - pct}%`, width: `${pct}%` }} />
          <div className="absolute inset-y-0 rounded-full border border-white/10" style={{ left: `${50 - Math.min(50, (m.floorPeakDisp[j] / maxPeak) * 50)}%`, right: `${50 - Math.min(50, (m.floorPeakDisp[j] / maxPeak) * 50)}%` }} />
        </div>
        <span className="num text-right text-[11px] text-slate-300">{(idr * 100).toFixed(2)}%</span>
        <span className="rounded px-1 py-px text-center text-[10px] font-semibold text-ink-950" style={{ background: DAMAGE_STATES[ds].color }}>{DAMAGE_STATES[ds].short}</span>
      </div>
    )
  }
  return (
    <div className="rounded-xl bg-ink-950/50 p-3 ring-1 ring-white/5">
      <div className="grid grid-cols-[38px_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 border-b border-white/5 pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
        <span>Floor</span>
        <span className="text-bare">Conventional · sway / drift / state</span>
        <span className={cx('text-tmd', !engine.p.tmdEnabled && 'opacity-40')}>With TMD · sway / drift / state</span>
      </div>
      <div className="scroll-thin max-h-[392px] overflow-y-auto pr-1">
        {rows.map((j) => (
          <div key={j} className="grid grid-cols-[38px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 border-b border-white/[0.03] py-[5px]">
            <span className="num text-[11px] text-slate-400">{j === n - 1 ? 'Roof' : `F${j + 1}`}</span>
            {cell(engine.bare, engine.mBare, j, BARE)}
            <div className={cx(!engine.p.tmdEnabled && 'opacity-40')}>{cell(engine.tmd, engine.mTmd, j, TMD)}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-slate-500">Bar = live floor displacement (outline = peak). Drift = live inter-story drift ratio. State = damage from the peak drift so far (HAZUS high-rise steel thresholds 0.3 / 0.6 / 1.2 / 3.0 %).</p>
    </div>
  )
}
