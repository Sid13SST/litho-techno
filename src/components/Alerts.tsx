import { BellRing, Box, Building2, Cpu, Hand, History, Shield, Siren, Trash2, Vibrate } from 'lucide-react'
import { ALERT_LEVELS, type AlertMonitor, type StabilityTrigger } from '../alerts/useAlertMonitor'
import { alertSound } from '../alerts/sound'
import { Badge, Button, Segmented, Slider, Toggle, cx } from './ui'

const SCALE_MAX = 0.3 // g, full scale of the gauge

export default function Alerts({ alert, go }: { alert: AlertMonitor; go: (tab: 'lab' | 'bench') => void }) {
  const { state, settings, history } = alert
  const lvl = state.active ? Math.max(1, state.level, state.maxLevel) : state.level
  const info = ALERT_LEVELS[lvl]

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* live status */}
        <div
          className={cx('panel relative overflow-hidden p-5 sm:p-6', state.active && 'ring-2')}
          style={state.active ? { boxShadow: `0 0 0 2px ${info.color}, 0 0 60px -10px ${info.color}` } : undefined}
        >
          {state.active && <div className="alert-stripes pointer-events-none absolute inset-0 opacity-[0.07]" />}
          <div className="relative grid items-center gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
            <Gauge value={state.value} color={info.color} active={state.active} />
            <div>
              <div className="label">Live status</div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-4xl font-extrabold tracking-tight" style={{ color: info.color }}>{state.active ? `${info.name} alert` : info.name}</span>
                {state.active && !state.acknowledged && <Badge tone="bad"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />Alarm sounding</Badge>}
                {state.active && state.acknowledged && <Badge tone="muted">Acknowledged</Badge>}
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-300">{state.eta !== null ? `Early warning: strong shaking expected in ${Math.ceil(state.eta)} s.` : info.action}</p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Shaking now', `${state.value.toFixed(3)} g`],
                  ['Event peak', state.active ? `${state.peak.toFixed(3)} g` : '—'],
                  ['Intensity', `MMI ${info.mmi}`],
                  ['Source', state.source ?? 'Idle'],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-xl bg-ink-950/60 p-3 ring-1 ring-white/5">
                    <div className="text-[10.5px] uppercase tracking-wider text-slate-500">{l}</div>
                    <div className="num mt-0.5 text-[15px] font-bold text-white">{v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {state.active && !state.acknowledged && <Button variant="primary" onClick={alert.acknowledge}><Shield className="h-4 w-4" />I'm safe, silence alarm</Button>}
                <Button variant="danger" onClick={alert.runTest} disabled={state.active}><Siren className="h-4 w-4" />Run test alert</Button>
                <Button onClick={() => go('lab')}><Box className="h-4 w-4" />Trigger a simulated quake</Button>
                <Button onClick={() => go('bench')}><Cpu className="h-4 w-4" />Arduino sensors</Button>
              </div>
            </div>
          </div>
        </div>

        {/* settings */}
        <div className="panel space-y-4 p-5">
          <div className="label flex items-center gap-2"><BellRing className="h-3.5 w-3.5" />Alert settings</div>
          <Toggle checked={settings.sound} onChange={(sound) => { alertSound.unlock(); alert.setSettings({ sound }) }} label="Alarm sound" sub="Chime, beeps or siren depending on level" />
          <Slider label="Volume" value={settings.volume} min={0} max={1} step={0.05} onChange={(volume) => alert.setSettings({ volume })} display={<>{Math.round(settings.volume * 100)}%</>} accent="#f43f5e" />
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-slate-300">Alert when shaking reaches</div>
            <Segmented<1 | 2 | 3> size="sm" value={settings.threshold} onChange={(threshold) => alert.setSettings({ threshold })} options={[1, 2, 3].map((l) => ({ value: l as 1 | 2 | 3, label: ALERT_LEVELS[l].name }))} />
            <div className="mt-1 text-[11.5px] text-slate-500">≥ {ALERT_LEVELS[settings.threshold].min.toFixed(2)} g ground or sensor acceleration</div>
          </div>
          <Toggle checked={settings.structural} onChange={(structural) => { alertSound.unlock(); alert.setSettings({ structural }) }} label={<span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-fuchsia-300" />Stability alarm</span>} sub="Separate low klaxon when a tower's stability drops" />
          {settings.structural && (
            <div>
              <div className="mb-1.5 text-[13px] font-medium text-slate-300">Ring when a tower becomes</div>
              <Segmented<StabilityTrigger> size="sm" value={settings.structLevel} onChange={(structLevel) => alert.setSettings({ structLevel })} options={[{ value: 'Marginal', label: 'Marginal (≥1.5 % drift)' }, { value: 'Unstable', label: 'Unstable (≥2.5 %)' }]} />
            </div>
          )}
          <Toggle checked={settings.vibrate} onChange={(vibrate) => alert.setSettings({ vibrate })} label={<span className="flex items-center gap-1.5"><Vibrate className="h-3.5 w-3.5" />Vibrate (phones)</span>} />
          <p className="text-[11.5px] leading-snug text-slate-500">The alarm sounds only while an alert is active, and stops when shaking ends or you press 'I'm safe'. Alerts watch the Simulation Lab and the Arduino sensors from every page.</p>
        </div>
      </div>

      {/* levels */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {ALERT_LEVELS.map((l) => (
          <div key={l.id} className={cx('panel p-4 transition', lvl === l.id && 'ring-2')} style={lvl === l.id ? { boxShadow: `0 0 0 2px ${l.color}` } : undefined}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[15px] font-bold" style={{ color: l.color }}><span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />{l.name}</span>
              <span className="num text-[11px] text-slate-500">MMI {l.mmi}</span>
            </div>
            <div className="num mt-1 text-[12px] text-slate-400">{l.id === 0 ? `< ${ALERT_LEVELS[1].min} g` : l.id < 3 ? `${l.min}–${ALERT_LEVELS[l.id + 1].min} g` : `≥ ${l.min} g`}</div>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-300">{l.action}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* safety */}
        <div className="panel p-5">
          <div className="label mb-4 flex items-center gap-2"><Hand className="h-3.5 w-3.5" />When the alert sounds</div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['1', 'Drop', 'Get down on your hands and knees before the shaking knocks you down.'],
              ['2', 'Cover', 'Get under a sturdy table or desk. Otherwise cover your head and neck next to an interior wall.'],
              ['3', 'Hold on', 'Hold on to your shelter until the shaking stops. Be ready to move with it.'],
            ].map(([n, t, d]) => (
              <div key={t} className="rounded-xl bg-ink-950/60 p-4 ring-1 ring-white/5">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-rose-500/15 text-sm font-extrabold text-rose-300 ring-1 ring-rose-400/30">{n}</div>
                <div className="mt-2 text-[15px] font-bold text-white">{t}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-slate-400">{d}</p>
              </div>
            ))}
          </div>
          <ul className="mt-4 space-y-1.5 text-[12.5px] text-slate-400">
            <li>• Stay away from windows, glass and tall furniture. Don't run outside during shaking.</li>
            <li>• Afterwards: expect aftershocks, check for gas leaks and injuries, and use stairs, not lifts.</li>
          </ul>
        </div>

        {/* history */}
        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="label flex items-center gap-2"><History className="h-3.5 w-3.5" />Alert history</div>
            {history.length > 0 && <Button className="px-2.5 py-1.5 text-xs" onClick={alert.clearHistory}><Trash2 className="h-3.5 w-3.5" />Clear</Button>}
          </div>
          {history.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">No alerts yet. Run a test alert or trigger a quake.</div>
          ) : (
            <div className="scroll-thin max-h-[300px] overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="pb-2 font-semibold">Time</th>
                    <th className="pb-2 font-semibold">Level</th>
                    <th className="pb-2 text-right font-semibold">Peak</th>
                    <th className="pb-2 text-right font-semibold">Duration</th>
                    <th className="pb-2 pl-3 font-semibold">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {history.map((e) => (
                    <tr key={e.start}>
                      <td className="num py-2 text-slate-300">{new Date(e.start).toLocaleTimeString()}</td>
                      <td className="py-2">{e.kind === 'structure'
                        ? <span className="font-semibold text-fuchsia-300" title={e.detail}>Stability</span>
                        : <span className="font-semibold" style={{ color: ALERT_LEVELS[e.level].color }}>{ALERT_LEVELS[e.level].name}</span>}</td>
                      <td className="num py-2 text-right text-slate-200">{e.kind === 'structure' ? `${e.peak.toFixed(0)}% margin` : `${e.peak.toFixed(3)} g`}</td>
                      <td className="num py-2 text-right text-slate-400">{((e.end - e.start) / 1000).toFixed(0)} s</td>
                      <td className="py-2 pl-3 text-slate-400">{e.kind === 'structure' ? e.detail?.split(' · ')[0] : e.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** semicircular gauge with level bands */
function Gauge({ value, color, active }: { value: number; color: string; active: boolean }) {
  const R = 100, cx0 = 120, cy0 = 120
  const ang = (g: number) => Math.PI * (1 - Math.min(1, g / SCALE_MAX))
  const pt = (a: number, r = R) => [cx0 + r * Math.cos(a), cy0 - r * Math.sin(a)] as const
  const arc = (g0: number, g1: number) => {
    const [x0, y0] = pt(ang(g0)), [x1, y1] = pt(ang(g1))
    return `M${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1}`
  }
  const bands = ALERT_LEVELS.map((l, i) => [l.min, i < 3 ? ALERT_LEVELS[i + 1].min : SCALE_MAX, l.color] as const)
  const [nx, ny] = pt(ang(value), R - 18)
  return (
    <svg viewBox="0 0 240 150" className="mx-auto w-full max-w-[260px]">
      {bands.map(([a, b, c]) => <path key={c} d={arc(a, b)} stroke={c} strokeOpacity={0.85} strokeWidth={14} fill="none" />)}
      <path d={arc(0, Math.min(value, SCALE_MAX))} stroke="#fff" strokeOpacity={0.9} strokeWidth={4} fill="none" strokeLinecap="round" />
      <line x1={cx0} y1={cy0} x2={nx} y2={ny} stroke={color} strokeWidth={4} strokeLinecap="round" />
      <circle cx={cx0} cy={cy0} r={8} fill={color} className={active ? 'alert-glow' : ''} />
      <text x={cx0} y={cy0 + 26} textAnchor="middle" fill="#fff" fontSize="18" fontWeight="800" fontFamily="JetBrains Mono, monospace">{value.toFixed(3)} g</text>
    </svg>
  )
}
