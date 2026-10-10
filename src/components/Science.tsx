import { useMemo } from 'react'
import { Building2, Cpu, Orbit, Waves } from 'lucide-react'
import { frequencyResponse, optimalTmd, tmdProperties, type SimParams } from '../sim/physics'
import { FrfChart } from './charts'
import { Slider } from './ui'

export default function Science({ params, setParams }: { params: SimParams; setParams: (p: Partial<SimParams>) => void }) {
  const frf = useMemo(() => frequencyResponse(params, params.f1 * 0.4, params.f1 * 1.8, 260), [params])
  const opt = optimalTmd(params.mu)
  const tmd = tmdProperties(params)
  let pb = 0, pt = 0
  for (let i = 0; i < frf.freqs.length; i++) { pb = Math.max(pb, frf.bare[i]); pt = Math.max(pt, frf.tmd[i]) }

  const steps = [
    { icon: Waves, title: 'The ground shakes', text: 'Seismic waves push the foundation back and forth. Soft soils filter this shaking toward long periods of 1–3 s, the same range tall towers sway in.' },
    { icon: Building2, title: 'The tower resonates', text: 'Every building has a natural frequency. When the shaking matches it, each cycle adds energy, and with only ~2% structural damping the sway can grow 25× larger than the static push.' },
    { icon: Orbit, title: 'The pendulum fights back', text: 'A heavy mass tuned just below that frequency swings out of phase with the building. Its cable and spring forces pull the roof back toward centre.' },
    { icon: Cpu, title: 'Dampers burn the energy', text: 'Viscous dampers between mass and floor turn that motion into heat. The single sharp resonance splits into two low, flat peaks.' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <div key={s.title} className="panel rise p-5" style={{ animationDelay: `${i * 70}ms` }}>
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/20"><s.icon className="h-[18px] w-[18px]" /></div>
              <span className="num text-xs text-slate-500">0{i + 1}</span>
            </div>
            <h3 className="mt-3 text-[15px] font-semibold text-white">{s.title}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{s.text}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="panel p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="label">Frequency response · roof displacement</div>
              <h3 className="mt-1 text-lg font-semibold text-white">The resonant peak drops from <span className="text-bare">{pb.toFixed(1)}×</span> to <span className="text-tmd">{pt.toFixed(1)}×</span></h3>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-bare" />Conventional</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-tmd" />With TMD</span>
            </div>
          </div>
          <div className="mt-4"><FrfChart freqs={frf.freqs} bare={frf.bare} tmd={frf.tmd} f1={params.f1} tmdOn height={300} /></div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-slate-400">
            Exact steady-state solution of the {params.stories + 1}-degree-of-freedom model, computed live from the same matrices the simulator uses.
            The dashed line marks the bare tower's natural frequency ({params.f1.toFixed(2)} Hz).
          </p>
        </div>

        <div className="panel space-y-5 p-5">
          <div className="label">Design the damper</div>
          <Slider label="Mass ratio μ" value={params.mu} min={0.01} max={0.1} step={0.005} onChange={(mu) => setParams({ mu, tuning: 1, zetaD: optimalTmd(mu).zeta })} display={<>{(params.mu * 100).toFixed(1)}%</>} hint="A heavier mass widens the band of protection" />
          <Slider label="Tuning" value={params.tuning} min={0.6} max={1.4} step={0.01} onChange={(tuning) => setParams({ tuning })} display={<>{tmd.fd.toFixed(3)} Hz</>} hint="Detune it and watch one peak shoot back up" />
          <Slider label="Damping ζd" value={params.zetaD} min={0} max={0.3} step={0.005} onChange={(zetaD) => setParams({ zetaD })} display={<>{(params.zetaD * 100).toFixed(1)}%</>} hint="Too little: two sharp peaks. Too much: the mass locks up" />
          <div className="rounded-xl bg-ink-950/70 p-4 ring-1 ring-white/5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Optimal tuning (Warburton, 1982)</div>
            <div className="num mt-2 space-y-1.5 text-[12.5px] text-slate-300">
              <div>f<sub>d</sub>/f<sub>1</sub> = √(1 − μ/2) / (1 + μ) = <span className="text-emerald-300">{opt.freqRatio.toFixed(3)}</span></div>
              <div>ζ<sub>d</sub> = √(3μ(1 − μ/4) / (8(1 + μ)(1 − μ/2))) = <span className="text-emerald-300">{(opt.zeta * 100).toFixed(1)}%</span></div>
            </div>
            <button className="mt-3 w-full rounded-lg bg-white/5 py-1.5 text-xs font-semibold text-sky-300 ring-1 ring-white/10 hover:bg-white/10" onClick={() => setParams({ tuning: 1, zetaD: opt.zeta })}>Apply optimum</button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <div className="label mb-3">Under the hood</div>
          <ul className="space-y-2.5 text-[13px] leading-relaxed text-slate-300">
            {[
              <><b className="text-white">{params.stories}-story shear building</b>, one lumped mass per floor ({(params.floorMass / 1000).toFixed(0)} t), stiffness solved in closed form for f₁ = {params.f1.toFixed(2)} Hz, with stiffness-proportional damping.</>,
              <><b className="text-white">Pendulum TMD</b> as an extra degree of freedom on the roof, with a nonlinear elastomer bumper ring at ±{params.stroke.toFixed(1)} m stroke. The mass can never leave its chamber.</>,
              <><b className="text-white">Runge–Kutta 4 integration at 480 Hz</b>, both towers driven by the exact same ground record and stepped in lock-step in your browser.</>,
              <><b className="text-white">Synthetic ground motion</b>: Clough–Penzien-filtered noise with a build-up/strong/decay envelope, scaled to a magnitude-based peak ground acceleration. Records are seeded, so every run is repeatable.</>,
              <><b className="text-white">Damage indicators</b>: inter-story drift ratio per floor (slab colours in 3D), roof acceleration, and base shear. These are the quantities building codes actually check.</>,
            ].map((t, i) => <li key={i} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" /><span>{t}</span></li>)}
          </ul>
        </div>
        <div className="panel p-5">
          <div className="label mb-3">In the real world</div>
          <div className="space-y-3">
            {[
              ['Taipei 101', 'Taipei, Taiwan', '660 t steel sphere suspended between floors 92 and 87, with 8 viscous dampers. Visitors can watch it swing during typhoons.'],
              ['Shanghai Tower', 'Shanghai, China', 'About 1,000 t damper that uses eddy-current (magnetic) damping instead of hydraulic cylinders.'],
              ['Citicorp Center', 'New York, USA', 'A ~400 t concrete block on an oil film, one of the first TMDs in a skyscraper (1977).'],
            ].map(([name, place, text]) => (
              <div key={name} className="rounded-xl bg-ink-950/60 p-3.5 ring-1 ring-white/5">
                <div className="flex items-baseline justify-between gap-2"><span className="text-[14px] font-semibold text-white">{name}</span><span className="text-[11px] text-slate-500">{place}</span></div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-slate-400">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
