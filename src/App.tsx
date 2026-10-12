import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Box, Cpu, Siren } from 'lucide-react'
import Lab, { useEngine } from './components/Lab'
import Bench from './components/Bench'
import Science from './components/Science'
import Alerts from './components/Alerts'
import AlertBanner from './components/AlertBanner'
import { useSensorBench } from './hooks/useSensorBench'
import { useAlertMonitor } from './alerts/useAlertMonitor'
import { alertSound } from './alerts/sound'
import { frequencyResponse, type SimParams } from './sim/physics'
import { cx } from './components/ui'

type Tab = 'lab' | 'bench' | 'alerts' | 'science'
const TABS: { id: Tab; label: string; icon: typeof Box }[] = [
  { id: 'lab', label: 'Simulation Lab', icon: Box },
  { id: 'bench', label: 'Hardware Bench', icon: Cpu },
  { id: 'alerts', label: 'Alerts', icon: Siren },
  { id: 'science', label: 'How It Works', icon: BookOpen },
]

const readHash = (): Tab => {
  const h = window.location.hash.replace('#', '')
  return (TABS.some((t) => t.id === h) ? h : 'lab') as Tab
}

export default function App() {
  const engine = useEngine()
  const [tab, setTab] = useState<Tab>(readHash)
  const [params, setParamsState] = useState<SimParams>(engine.p)
  // sensors live at app level so the alert monitor sees them from any page (and the port stays open across tabs)
  const bench = useSensorBench()
  const alert = useAlertMonitor(engine, bench)

  // browsers block audio until a user gesture: unlock the alarm on the first interaction anywhere
  useEffect(() => {
    const unlock = () => alertSound.unlock()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock) }
  }, [])

  const setParams = useCallback((p: Partial<SimParams>) => {
    engine.update(p)
    setParamsState({ ...engine.p })
  }, [engine])

  useEffect(() => {
    const on = () => setTab(readHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const go = (t: Tab) => { window.location.hash = t; setTab(t); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  const peakCut = useMemo(() => {
    const f = frequencyResponse(params, params.f1 * 0.5, params.f1 * 1.6, 160)
    let b = 0, t = 0
    for (let i = 0; i < f.freqs.length; i++) { b = Math.max(b, f.bare[i]); t = Math.max(t, f.tmd[i]) }
    return { b, t }
  }, [params])

  const heading = {
    lab: { kicker: 'Live structural dynamics', title: <>One earthquake. Two towers. <span className="bg-gradient-to-r from-sky-300 to-cyan-200 bg-clip-text text-transparent">One tuned mass damper.</span></>, sub: 'Both 72 m towers feel the exact same ground motion. The right one has a pendulum damper in its crown that swings against the sway. Trigger a quake and compare.' },
    bench: { kicker: 'Arduino + MPU-6050', title: <>Measure it on a <span className="bg-gradient-to-r from-amber-200 to-amber-400 bg-clip-text text-transparent">real shake table</span></>, sub: 'Plug in the physical model over USB and record the roof acceleration of both buildings side by side, or use the built-in virtual shake table.' },
    alerts: { kicker: 'Earthquake early warning', title: <>Know <span className="bg-gradient-to-r from-rose-300 to-orange-300 bg-clip-text text-transparent">before the shaking</span> peaks</>, sub: 'A live alert system watching the simulator and the Arduino sensors. When shaking crosses the threshold, every page shows a full-width alert with an alarm, so people can drop, cover and hold on.' },
    science: { kicker: 'The physics', title: <>Why a swinging mass <span className="bg-gradient-to-r from-sky-300 to-cyan-200 bg-clip-text text-transparent">stops a skyscraper</span></>, sub: 'Resonance, tuning and damping explained with the same model that powers the simulator.' },
  }[tab]

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3 sm:px-6">
          <a href="#lab" onClick={(e) => { e.preventDefault(); go('lab') }} className="flex items-center gap-2.5">
            <Logo />
            <div className="leading-tight">
              <div className="text-[15px] font-bold tracking-tight text-white">SeismoShield</div>
              <div className="hidden text-[11px] text-slate-500 sm:block">Earthquake-resistant structures lab</div>
            </div>
          </a>
          <nav className="ml-auto flex rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/8">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => go(t.id)} className={cx('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold transition sm:px-3.5', tab === t.id ? 'bg-white text-ink-950 shadow' : 'text-slate-400 hover:text-white')}>
                <span className="relative">
                  <t.icon className="h-4 w-4" />
                  {t.id === 'alerts' && alert.state.active && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-ink-950"><span className="ping-soft absolute inset-0 rounded-full bg-rose-500" /></span>}
                </span>
                <span className="hidden md:inline">{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <AlertBanner alert={alert} onOpen={() => go('alerts')} />

      <main className="mx-auto max-w-[1500px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        <div key={tab} className="rise mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="label text-sky-300/90">{heading.kicker}</div>
            <h1 className="mt-2 text-[28px] font-extrabold leading-[1.1] tracking-tight text-white sm:text-4xl">{heading.title}</h1>
            <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-slate-400">{heading.sub}</p>
          </div>
          {tab === 'lab' && (
            <div className="flex gap-2.5">
              <HeroStat value={`${peakCut.b.toFixed(0)}× → ${peakCut.t.toFixed(1)}×`} label="resonant amplification" />
              <HeroStat value={`${((1 - peakCut.t / peakCut.b) * 100).toFixed(0)}%`} label="peak response cut" accent />
            </div>
          )}
        </div>

        {tab === 'lab' && <Lab engine={engine} params={params} setParams={setParams} alert={alert} />}
        {tab === 'bench' && <Bench s={bench} alert={alert} />}
        {tab === 'alerts' && <Alerts alert={alert} go={go} />}
        {tab === 'science' && <Science params={params} setParams={setParams} />}
      </main>

      <footer className="border-t border-white/5 py-6 text-center text-[12px] text-slate-500">
        SeismoShield · physics runs entirely in your browser · built for education, not for structural design
      </footer>
    </div>
  )
}

function HeroStat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className={cx('rounded-2xl px-4 py-3 ring-1', accent ? 'bg-emerald-400/10 ring-emerald-400/25' : 'bg-white/[0.04] ring-white/10')}>
      <div className={cx('num text-xl font-bold', accent ? 'text-emerald-300' : 'text-white')}>{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-9 w-9">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset="1" stopColor="#22d3ee" /></linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="#0e1524" stroke="rgba(148,163,184,.2)" />
      <path d="M11 26V9.5l5-3.5 5 3.5V26" fill="none" stroke="url(#lg)" strokeWidth="2.2" strokeLinejoin="round" />
      <line x1="16" y1="9" x2="16" y2="13" stroke="#cbd5e1" strokeWidth="1" />
      <circle cx="16" cy="15" r="2.6" fill="#f5b83d" />
      <path d="M4 26h24" stroke="url(#lg)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}
