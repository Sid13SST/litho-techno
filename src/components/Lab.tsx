import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Camera, ChevronDown, Dice5, Gauge, Pause, Play, RotateCcw, Settings2, ShieldCheck, Sparkles, Waves } from 'lucide-react'
import { SeismicEngine, driftLevel, reduction, type TowerMetrics } from '../sim/engine'
import { DEFAULT_PARAMS, buildingModal, optimalTmd, tmdProperties, type Scenario, type SimParams } from '../sim/physics'
import { SCENARIOS, intensityLabel, pgaFromMagnitude } from '../sim/ground'
import { LiveChart, Seismogram } from './charts'
import { Badge, Button, Section, Segmented, Slider, Toggle, cx, fmt } from './ui'
import type { ColorMode, ViewMode } from './TowerScene'
import FloorMonitor from './FloorMonitor'

const TowerScene = lazy(() => import('./TowerScene'))

export function useEngine() {
  return useMemo(() => {
    const e = new SeismicEngine(DEFAULT_PARAMS)
    if (import.meta.env.DEV) (window as unknown as { __engine: SeismicEngine }).__engine = e
    return e
  }, [])
}

export default function Lab({ engine, params, setParams }: { engine: SeismicEngine; params: SimParams; setParams: (p: Partial<SimParams>) => void }) {
  const [, setTick] = useState(0)
  const [view, setView] = useState<ViewMode>('front')
  const [exag, setExag] = useState(6)
  const [speed, setSpeed] = useState(1)
  const [advanced, setAdvanced] = useState(false)
  const exagRef = useRef(exag)
  exagRef.current = exag
  const [colorMode, setColorMode] = useState<ColorMode>('live')
  const colorRef = useRef(colorMode)
  colorRef.current = colorMode

  useEffect(() => { engine.speed = speed }, [engine, speed])
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 100)
    return () => clearInterval(id)
  }, [])

  const play = () => {
    if (engine.finished) engine.restart(true)
    else engine.playing = !engine.playing
    setTick((t) => t + 1)
  }
  const restart = () => { engine.restart(true); setTick((t) => t + 1) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.code === 'Space') { e.preventDefault(); play() }
      if (e.key === 'r' || e.key === 'R') restart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const tmd = tmdProperties(params)
  const modal = buildingModal(params)
  const opt = optimalTmd(params.mu)
  const pga = pgaFromMagnitude(params.magnitude)
  const intensity = intensityLabel(params.scenario === 'resonance' ? pga * 0.12 : pga)
  const progress = Math.min(1, engine.t / engine.endTime)
  const agNow = Math.abs(engine.agAt(engine.t)) / 9.81
  const shaking = engine.playing && agNow > engine.rec.pga * 0.08
  const stroke = engine.strokeNow()
  const atLimit = params.tmdEnabled && Math.abs(stroke) > params.stroke
  const idle = !engine.playing && engine.t === 0

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* ---------------- viewport ---------------- */}
      <div className="space-y-4">
        <div className="panel relative overflow-hidden p-0" style={{ height: 'min(74vh, 700px)', minHeight: 460 }}>
          <Suspense fallback={<div className="grid h-full place-items-center text-sm text-slate-500">Loading 3D engine…</div>}>
            <TowerScene engine={engine} exaggeration={exagRef} colorMode={colorRef} view={view} />
          </Suspense>

          {/* tower cards */}
          <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3 sm:inset-x-4 sm:top-4">
            <TowerCard kind="bare" title="Conventional tower" sub="No damping device" m={engine.mBare} roof={engine.roof(engine.bare)} />
            <div className="hidden flex-col items-center gap-2 md:flex">
              <StatusPill shaking={shaking} playing={engine.playing} finished={engine.finished} t={engine.t} />
              {atLimit && <Badge tone="bad">TMD at stroke limit · bumper engaged</Badge>}
            </div>
            <TowerCard kind="tmd" title={params.tmdEnabled ? 'Tuned mass damper' : 'TMD disabled'} sub={params.tmdEnabled ? `${(tmd.md / 1000).toFixed(0)} t pendulum · ${tmd.fd.toFixed(2)} Hz` : 'Identical tower'} m={engine.mTmd} roof={engine.roof(engine.tmd)} compare={engine.mBare} />
          </div>

          {/* center call-to-action */}
          {idle && (
            <div className="absolute inset-0 grid place-items-center bg-ink-950/25">
              <button onClick={play} className="group rise flex flex-col items-center gap-3">
                <span className="relative grid h-20 w-20 place-items-center rounded-full bg-white text-ink-950 shadow-[0_0_60px_rgba(56,189,248,.45)] transition group-hover:scale-105">
                  <span className="ping-soft absolute inset-0 rounded-full bg-sky-300/40" />
                  <Play className="relative ml-1 h-8 w-8" fill="currentColor" />
                </span>
                <span className="rounded-full bg-ink-950/80 px-4 py-1.5 text-sm font-semibold text-white ring-1 ring-white/10">
                  Trigger M{params.magnitude.toFixed(1)} {SCENARIOS[params.scenario].short.toLowerCase()}
                </span>
                <span className="text-xs text-slate-400">Space to play/pause · R to restart</span>
              </button>
            </div>
          )}
          {engine.finished && <ResultOverlay engine={engine} onReplay={restart} />}

          {/* bottom bar */}
          <div className="absolute inset-x-3 bottom-3 sm:inset-x-4 sm:bottom-4">
            <div className="flex items-center gap-2 rounded-2xl bg-ink-950/80 p-2 ring-1 ring-white/10 backdrop-blur-md">
              <button onClick={play} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-ink-950 transition hover:bg-sky-100" title="Play / pause (Space)">
                {engine.playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}
              </button>
              <button onClick={restart} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 text-slate-200 ring-1 ring-white/10 transition hover:bg-white/10" title="Restart (R)">
                <RotateCcw className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between text-[10.5px] text-slate-400">
                  <span className="num">{engine.t.toFixed(1)}s / {engine.endTime.toFixed(0)}s</span>
                  <span className="num hidden sm:inline">ground {agNow.toFixed(3)} g · PGA {engine.rec.pga.toFixed(2)} g</span>
                </div>
                <div className="relative h-8 overflow-hidden rounded-lg bg-white/[0.03]">
                  <Seismogram engine={engine} />
                  <div className="pointer-events-none absolute inset-y-0 left-0 bg-white/[0.03]" style={{ width: `${progress * 100}%` }} />
                </div>
              </div>
              <div className="hidden w-[176px] shrink-0 sm:block">
                <Segmented size="sm" value={view} onChange={setView} options={[
                  { value: 'front', label: 'Front' },
                  { value: 'tmd', label: 'Damper', title: 'Close-up of the TMD chamber' },
                  { value: 'orbit', label: 'Orbit' },
                ]} />
              </div>
            </div>
          </div>
        </div>

        {/* charts + metrics */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="panel p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="label flex items-center gap-2"><Activity className="h-3.5 w-3.5" />Roof displacement (m)</div>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <Legend color="bg-bare" label="Conventional" />
                <Legend color="bg-tmd" label="With TMD" />
                <span className="hidden items-center gap-1.5 sm:flex"><span className="h-2.5 w-4 rounded-sm bg-amber-400/20" />strong motion</span>
              </div>
            </div>
            <div className="h-[230px]"><LiveChart engine={engine} /></div>
          </div>
          <Metrics engine={engine} />
        </div>

        <FloorMonitor engine={engine} />
      </div>

      {/* ---------------- control panel ---------------- */}
      <aside className="panel scroll-thin h-fit space-y-6 p-5 lg:sticky lg:top-20">
        <Section title="Earthquake" icon={<Waves className="h-3.5 w-3.5" />}>
          <Segmented<Scenario>
            value={params.scenario}
            onChange={(scenario) => setParams({ scenario })}
            options={(Object.keys(SCENARIOS) as Scenario[]).map((k) => ({ value: k, label: SCENARIOS[k].short, title: SCENARIOS[k].name }))}
          />
          <p className="text-[12px] leading-relaxed text-slate-400">{SCENARIOS[params.scenario].blurb}</p>
          <Slider
            label="Magnitude"
            value={params.magnitude}
            min={4.5}
            max={8}
            step={0.1}
            accent="#fbbf24"
            onChange={(magnitude) => setParams({ magnitude })}
            display={<span className="text-amber-300">M {params.magnitude.toFixed(1)}</span>}
            hint={<>PGA ≈ {(params.scenario === 'resonance' ? pga * 0.12 : pga).toFixed(2)} g · MMI {intensity.mmi} ({intensity.text})</>}
          />
          {params.scenario !== 'resonance' && (
            <Button className="w-full" onClick={() => setParams({ seed: params.seed + 1 })}>
              <Dice5 className="h-4 w-4" /> New ground-motion record
            </Button>
          )}
        </Section>

        <div className="h-px bg-white/5" />

        <Section
          title="Tuned mass damper"
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          aside={params.tmdEnabled && (Math.abs(params.tuning - 1) > 0.005 || Math.abs(params.zetaD - opt.zeta) > 0.005) ? (
            <button className="flex items-center gap-1 text-[11px] font-semibold text-sky-300 hover:text-sky-200" onClick={() => setParams({ tuning: 1, zetaD: opt.zeta })}>
              <Sparkles className="h-3 w-3" /> Optimise
            </button>
          ) : undefined}
        >
          <Toggle checked={params.tmdEnabled} onChange={(tmdEnabled) => setParams({ tmdEnabled })} label="Damper installed" sub="Right-hand tower only" />
          <div className={cx('space-y-4 transition', !params.tmdEnabled && 'pointer-events-none opacity-40')}>
            <Slider
              label="Mass ratio μ"
              value={params.mu}
              min={0.01}
              max={0.1}
              step={0.005}
              onChange={(mu) => setParams({ mu, zetaD: Math.abs(params.zetaD - opt.zeta) < 0.005 ? optimalTmd(mu).zeta : params.zetaD })}
              display={<>{(params.mu * 100).toFixed(1)}%</>}
              hint={<>{(tmd.md / 1000).toFixed(0)} t of steel, {((tmd.md / modal.totalMass) * 100).toFixed(1)}% of the building's weight</>}
            />
            <Slider
              label="Tuning"
              value={params.tuning}
              min={0.6}
              max={1.4}
              step={0.01}
              onChange={(tuning) => setParams({ tuning })}
              display={<>{tmd.fd.toFixed(3)} Hz</>}
              hint={Math.abs(params.tuning - 1) < 0.005 ? <span className="text-emerald-400">Optimally tuned (Warburton)</span> : <>{params.tuning > 1 ? '+' : ''}{((params.tuning - 1) * 100).toFixed(0)}% off the optimum, {(opt.freqRatio * params.f1).toFixed(3)} Hz</>}
            />
            <Slider
              label="Damper damping ζd"
              value={params.zetaD}
              min={0}
              max={0.3}
              step={0.005}
              onChange={(zetaD) => setParams({ zetaD })}
              display={<>{(params.zetaD * 100).toFixed(1)}%</>}
              hint={Math.abs(params.zetaD - opt.zeta) < 0.005 ? <span className="text-emerald-400">Optimal for μ = {(params.mu * 100).toFixed(1)}%</span> : <>Optimum is {(opt.zeta * 100).toFixed(1)}%</>}
            />
          </div>
        </Section>

        <div className="h-px bg-white/5" />

        <Section title="Display" icon={<Camera className="h-3.5 w-3.5" />}>
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-slate-300">Floor slab colours</div>
            <Segmented<ColorMode> size="sm" value={colorMode} onChange={setColorMode} options={[{ value: 'live', label: 'Live drift' }, { value: 'damage', label: 'Damage map' }]} />
            <div className="mt-1 text-[11.5px] text-slate-500">{colorMode === 'live' ? 'Each floor glows by its current inter-story drift.' : 'Each floor shows the worst damage state reached so far.'}</div>
          </div>
          <Slider label="Sway exaggeration" value={exag} min={1} max={20} step={1} onChange={setExag} display={<>{exag}×</>} hint="Visual only. Every number shown is the real, unscaled value." />
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-slate-300">Playback speed</div>
            <Segmented size="sm" value={speed} onChange={setSpeed} options={[0.5, 1, 2, 4].map((v) => ({ value: v, label: `${v}×` }))} />
          </div>
          <div className="sm:hidden">
            <div className="mb-1.5 text-[13px] font-medium text-slate-300">Camera</div>
            <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'front', label: 'Front' }, { value: 'tmd', label: 'Damper' }, { value: 'orbit', label: 'Orbit' }]} />
          </div>
        </Section>

        <div>
          <button onClick={() => setAdvanced((a) => !a)} className="label flex w-full items-center justify-between hover:text-slate-200">
            <span className="flex items-center gap-2"><Settings2 className="h-3.5 w-3.5" />Building properties</span>
            <ChevronDown className={cx('h-4 w-4 transition', advanced && 'rotate-180')} />
          </button>
          {advanced && (
            <div className="mt-4 space-y-4">
              <Slider label="Natural frequency f₁" value={params.f1} min={0.3} max={1.2} step={0.01} onChange={(f1) => setParams({ f1 })} display={<>{params.f1.toFixed(2)} Hz</>} hint={<>Period T₁ = {(1 / params.f1).toFixed(2)} s · {params.stories} stories, {(params.stories * params.storyHeight).toFixed(0)} m</>} />
              <Slider label="Structural damping ζ" value={params.zeta} min={0.01} max={0.05} step={0.0025} onChange={(zeta) => setParams({ zeta })} display={<>{(params.zeta * 100).toFixed(1)}%</>} hint="Typical steel tower: 1–2%" />
              <Slider label="TMD stroke limit" value={params.stroke} min={0.6} max={3} step={0.1} onChange={(stroke) => setParams({ stroke })} display={<>±{params.stroke.toFixed(1)} m</>} hint="Beyond this the mass hits the elastomer bumper ring" />
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={cx('h-2 w-2 rounded-full', color)} />{label}</span>
}

function StatusPill({ shaking, playing, finished, t }: { shaking: boolean; playing: boolean; finished: boolean; t: number }) {
  const [text, cls, dot] = finished
    ? ['Test complete', 'text-emerald-300 ring-emerald-400/30', 'bg-emerald-400']
    : shaking
      ? ['Strong ground motion', 'text-amber-200 ring-amber-400/40', 'bg-amber-400']
      : playing
        ? ['Monitoring', 'text-sky-200 ring-sky-400/30', 'bg-sky-400']
        : t > 0 ? ['Paused', 'text-slate-300 ring-white/15', 'bg-slate-400'] : ['Ready', 'text-slate-300 ring-white/15', 'bg-slate-400']
  return (
    <div className={cx('flex items-center gap-2 rounded-full bg-ink-950/80 px-3 py-1.5 text-xs font-semibold ring-1 backdrop-blur', cls)}>
      <span className="relative flex h-2 w-2">
        {(shaking || (playing && !finished)) && <span className={cx('ping-soft absolute inset-0 rounded-full', dot)} />}
        <span className={cx('relative h-2 w-2 rounded-full', dot)} />
      </span>
      {text}
    </div>
  )
}

function TowerCard({ kind, title, sub, m, roof, compare }: { kind: 'bare' | 'tmd'; title: string; sub: string; m: TowerMetrics; roof: number; compare?: TowerMetrics }) {
  const level = driftLevel(m.peakIdr)
  const red = compare ? reduction(compare.peakRoof, m.peakRoof) : null
  return (
    <div className={cx('w-[150px] rounded-2xl bg-ink-950/75 p-3 ring-1 backdrop-blur-md sm:w-[210px]', kind === 'bare' ? 'ring-rose-400/25' : 'ring-sky-400/30', kind === 'tmd' && 'text-right')}>
      <div className={cx('flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider', kind === 'bare' ? 'text-bare' : 'flex-row-reverse text-tmd')}>
        <span className={cx('h-2 w-2 rounded-full', kind === 'bare' ? 'bg-bare' : 'bg-tmd')} />{title}
      </div>
      <div className="mt-0.5 hidden text-[11px] text-slate-500 sm:block">{sub}</div>
      <div className="mt-2 flex items-baseline gap-1.5" style={{ justifyContent: kind === 'tmd' ? 'flex-end' : 'flex-start' }}>
        <span className="num text-xl font-bold text-white sm:text-2xl">{roof >= 0 ? '+' : '−'}{Math.abs(roof).toFixed(2)}</span>
        <span className="text-xs text-slate-400">m roof</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-400">peak <span className="num text-slate-200">{m.peakRoof.toFixed(2)} m</span>{red !== null && m.peakRoof > 0.005 && <span className={cx('num ml-1 font-semibold', red >= 0 ? 'text-emerald-400' : 'text-rose-400')}>({red >= 0 ? '−' : '+'}{Math.abs(red).toFixed(0)}%)</span>}</div>
      <div className={cx('mt-2 hidden sm:flex', kind === 'tmd' && 'justify-end')}>
        <Badge tone={m.peakIdr === 0 ? 'muted' : level.tone}>{level.label}</Badge>
      </div>
    </div>
  )
}

function Metrics({ engine }: { engine: SeismicEngine }) {
  const b = engine.mBare, d = engine.mTmd
  const rows: { label: string; unit: string; bare: number; tmd: number; digits: number; tip: string }[] = [
    { label: 'Peak roof drift', unit: 'm', bare: b.peakRoof, tmd: d.peakRoof, digits: 2, tip: 'Maximum lateral displacement of the roof relative to the ground' },
    { label: 'RMS roof sway', unit: 'm', bare: engine.rms(b), tmd: engine.rms(d), digits: 3, tip: 'Root-mean-square motion: how much the building moves overall' },
    { label: 'Peak inter-story drift', unit: '%', bare: b.peakIdr * 100, tmd: d.peakIdr * 100, digits: 2, tip: 'Worst relative displacement between two floors divided by story height. Main damage indicator' },
    { label: 'Peak roof acceleration', unit: 'g', bare: b.peakAcc, tmd: d.peakAcc, digits: 2, tip: 'What occupants and contents feel at the top floor' },
    { label: 'Peak base shear', unit: '% W', bare: b.peakShear * 100, tmd: d.peakShear * 100, digits: 1, tip: 'Horizontal force at the foundation as a share of building weight' },
  ]
  const s = engine.strokeNow()
  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="label flex items-center gap-2"><Gauge className="h-3.5 w-3.5" />Performance</div>
        <div className="flex gap-3 text-[10.5px] font-semibold uppercase tracking-wider"><span className="text-bare">Conv.</span><span className="text-tmd">TMD</span><span className="w-12 text-right text-slate-500">Δ</span></div>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => {
          const red = reduction(r.bare, r.tmd)
          const max = Math.max(r.bare, r.tmd, 1e-9)
          const has = r.bare > 1e-6
          return (
            <div key={r.label} title={r.tip}>
              <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                <span className="text-slate-300">{r.label}</span>
                <span className="num flex items-baseline gap-3">
                  <span className="text-rose-200">{fmt(r.bare, r.digits)}</span>
                  <span className="text-sky-200">{fmt(r.tmd, r.digits)}</span>
                  <span className={cx('w-12 text-right font-semibold', !has ? 'text-slate-600' : red >= 0 ? 'text-emerald-400' : 'text-rose-400')}>{has ? `${red >= 0 ? '−' : '+'}${Math.abs(red).toFixed(0)}%` : '—'}</span>
                </span>
              </div>
              <div className="mt-1 space-y-[3px]">
                <div className="h-[3px] rounded-full bg-bare/80 transition-all duration-200" style={{ width: `${(r.bare / max) * 100}%` }} />
                <div className="h-[3px] rounded-full bg-tmd transition-all duration-200" style={{ width: `${(r.tmd / max) * 100}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      {engine.p.tmdEnabled && (
        <div className="mt-4 rounded-xl bg-ink-950/60 p-3 ring-1 ring-white/5">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-slate-300">Damper stroke</span>
            <span className="num text-slate-400">peak <span className="text-white">{engine.peakStroke.toFixed(2)}</span> / ±{engine.p.stroke.toFixed(1)} m{engine.bumperHits > 0 && <span className="ml-1.5 text-rose-400">· {engine.bumperHits} bumper hit{engine.bumperHits > 1 ? 's' : ''}</span>}</span>
          </div>
          <div className="relative mt-2 h-2.5 rounded-full bg-white/5">
            <div className="absolute inset-y-0 left-1/2 w-px bg-white/20" />
            <div className="absolute inset-y-0 rounded-full bg-amber-400/25" style={{ left: `${50 - Math.min(50, (engine.peakStroke / engine.p.stroke) * 50)}%`, right: `${50 - Math.min(50, (engine.peakStroke / engine.p.stroke) * 50)}%` }} />
            <div className={cx('absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ink-950', Math.abs(s) > engine.p.stroke ? 'bg-rose-500' : 'bg-amber-300')} style={{ left: `${50 + Math.max(-50, Math.min(50, (s / engine.p.stroke) * 50))}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}

function ResultOverlay({ engine, onReplay }: { engine: SeismicEngine; onReplay: () => void }) {
  const b = engine.mBare, d = engine.mTmd
  const peak = reduction(b.peakRoof, d.peakRoof)
  const rms = reduction(engine.rms(b), engine.rms(d))
  const idr = reduction(b.peakIdr, d.peakIdr)
  const on = engine.p.tmdEnabled
  return (
    <div className="absolute inset-0 grid place-items-center bg-ink-950/55 p-4 backdrop-blur-[2px]">
      <div className="rise w-full max-w-md rounded-3xl bg-ink-900/95 p-6 text-center ring-1 ring-white/10 shadow-2xl">
        <div className="label">Test complete · M{engine.p.magnitude.toFixed(1)} {SCENARIOS[engine.p.scenario].short.toLowerCase()}</div>
        {on ? (
          <>
            <div className="mt-3 text-5xl font-extrabold tracking-tight text-white"><span className="num">{rms.toFixed(0)}%</span></div>
            <div className="mt-1 text-sm text-slate-300">less overall sway with the tuned mass damper</div>
            <div className="mt-5 grid grid-cols-3 gap-2 text-left">
              {[
                ['Peak drift', peak],
                ['Story drift', idr],
                ['Roof accel.', reduction(b.peakAcc, d.peakAcc)],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-xl bg-white/[0.04] p-2.5 ring-1 ring-white/5">
                  <div className="text-[10.5px] uppercase tracking-wider text-slate-500">{l}</div>
                  <div className={cx('num text-lg font-bold', (v as number) >= 0 ? 'text-emerald-400' : 'text-rose-400')}>{(v as number) >= 0 ? '−' : '+'}{Math.abs(v as number).toFixed(0)}%</div>
                </div>
              ))}
            </div>
            {engine.bumperHits > 0 && <p className="mt-4 text-xs text-rose-300/90">The damper ran out of stroke {engine.bumperHits}×. Even big dampers have limits in extreme events.</p>}
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-300">Both towers are identical. Enable the damper to compare.</p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="primary" onClick={onReplay}><RotateCcw className="h-4 w-4" />Replay</Button>
        </div>
      </div>
    </div>
  )
}
