import { Radar, ShieldCheck, Siren, Volume2, VolumeX } from 'lucide-react'
import { ALERT_LEVELS, type AlertMonitor } from '../alerts/useAlertMonitor'
import { AlertChart, type AlertTrace } from './charts'
import { cx } from './ui'

/** Seismic trace + alert card side by side: the card sleeps until the graph detects shaking. */
export default function SeismicAlertStrip({ alert, getTrace, title, unitLabel }: { alert: AlertMonitor; getTrace: () => AlertTrace; title: string; unitLabel?: string }) {
  const { state, settings } = alert
  const lvl = state.active ? Math.max(1, state.level, state.maxLevel) : 0
  const info = ALERT_LEVELS[lvl]
  const thr = ALERT_LEVELS[settings.threshold]
  const awake = state.active

  return (
    <div
      className={cx('panel grid gap-0 overflow-hidden p-0 transition-shadow duration-500 lg:grid-cols-[minmax(0,1fr)_300px]')}
      style={awake ? { boxShadow: `0 0 0 2px ${info.color}, 0 0 50px -12px ${info.color}` } : undefined}
    >
      <div className="flex flex-col p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="label flex items-center gap-2"><Radar className="h-3.5 w-3.5" />{title}</div>
          <div className="text-[11px] text-slate-400">armed at <span className="font-semibold" style={{ color: thr.color }}>{thr.name} ≥ {thr.min} g</span></div>
        </div>
        <div className="h-[240px]"><AlertChart getTrace={getTrace} threshold={thr.min} unitLabel={unitLabel} /></div>
      </div>

      {/* the alert card: dormant → awake */}
      <div className={cx('relative flex flex-col justify-center border-t border-white/5 p-5 transition-colors duration-500 lg:border-l lg:border-t-0', awake ? '' : 'bg-ink-950/40')}
        style={awake ? { background: `linear-gradient(160deg, ${info.color}33, ${info.color}10 60%, transparent)` } : undefined}
      >
        {awake && <div className="alert-stripes pointer-events-none absolute inset-0 opacity-10" />}
        {!awake ? (
          <div className="relative text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/25">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <div className="mt-3 text-[15px] font-bold text-white">Alert system armed</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-400">Watching this graph. The alarm wakes up the moment shaking crosses the {thr.name.toLowerCase()} line.</p>
            <div className="num mt-3 text-[12px] text-slate-500">now {state.value.toFixed(3)} g</div>
          </div>
        ) : (
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full text-white" style={{ background: info.color }}>
                {!state.acknowledged && <span className="ping-soft absolute inset-0 rounded-full" style={{ background: info.color }} />}
                <Siren className="relative h-6 w-6" />
              </span>
              <div>
                <div className="text-[10.5px] font-bold uppercase tracking-[0.16em]" style={{ color: info.color }}>Earthquake detected</div>
                <div className="text-2xl font-extrabold leading-tight text-white">{info.name} alert</div>
              </div>
            </div>
            <p className="mt-3 text-[13.5px] font-semibold leading-snug text-white">
              {state.eta !== null ? `Strong shaking in ${Math.ceil(state.eta)} s. Drop, cover, hold on.` : info.action}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[['Now', state.value.toFixed(3)], ['Peak', state.peak.toFixed(3)], ['MMI', info.mmi]].map(([l, v]) => (
                <div key={l} className="rounded-lg bg-black/25 px-1.5 py-1.5">
                  <div className="text-[9.5px] uppercase tracking-wider text-slate-300/80">{l}</div>
                  <div className="num text-[13px] font-bold text-white">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              {!state.acknowledged ? (
                <button onClick={alert.acknowledge} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white py-2 text-[13px] font-bold text-ink-950 hover:bg-white/90">
                  <ShieldCheck className="h-4 w-4" />I'm safe
                </button>
              ) : (
                <span className="flex flex-1 items-center justify-center rounded-lg bg-black/25 py-2 text-[12px] font-semibold text-slate-200">Acknowledged</span>
              )}
              <button
                onClick={() => alert.setSettings({ sound: !settings.sound })}
                className="grid w-10 place-items-center rounded-lg bg-black/25 text-white hover:bg-black/40"
                aria-label={settings.sound ? 'Mute alarm' : 'Unmute alarm'}
                title={settings.sound ? 'Mute alarm' : 'Unmute alarm'}
              >
                {settings.sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
