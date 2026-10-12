import { useEffect, useState } from 'react'
import { BellOff, Building2, CheckCircle2, ChevronRight, ShieldCheck, Siren, Volume2, VolumeX } from 'lucide-react'
import { ALERT_LEVELS, type AlertMonitor } from '../alerts/useAlertMonitor'
import { cx } from './ui'

const LEVEL_STYLE = [
  { bg: '', ring: '', text: '' },
  { bg: 'from-amber-500/95 to-amber-600/95', ring: 'ring-amber-300/60', text: 'text-amber-950' },
  { bg: 'from-orange-500/95 to-red-600/95', ring: 'ring-orange-300/60', text: 'text-white' },
  { bg: 'from-red-600/95 to-rose-700/95', ring: 'ring-red-300/70', text: 'text-white' },
]

/** Sticky, impossible-to-miss alert strip + pulsing screen-edge glow while the ground is shaking. */
export default function AlertBanner({ alert, onOpen }: { alert: AlertMonitor; onOpen: () => void }) {
  const { state, settings } = alert
  const sa = state.structural
  const [, tick] = useState(0)
  useEffect(() => {
    if (!state.active) return
    const id = setInterval(() => tick((t) => t + 1), 500)
    return () => clearInterval(id)
  }, [state.active])

  // "all clear" toast for a few seconds after an event ends
  const [clearVisible, setClearVisible] = useState(false)
  useEffect(() => {
    if (!state.allClearAt) return
    setClearVisible(true)
    const id = setTimeout(() => setClearVisible(false), 6000)
    return () => clearTimeout(id)
  }, [state.allClearAt])

  const lvl = Math.max(1, state.level, state.maxLevel) // the worst level of this event, same as the graph panel
  const info = ALERT_LEVELS[lvl]
  const style = LEVEL_STYLE[lvl]
  const elapsed = state.active ? Math.max(0, (Date.now() - state.startedAt) / 1000) : 0

  return (
    <>
      {/* screen-edge glow: strong and pulsing for Warning/Severe until acknowledged */}
      {state.active && (
        <div
          aria-hidden
          className={cx('pointer-events-none fixed inset-0 z-40', !state.acknowledged && state.level >= 2 ? 'alert-glow' : '')}
          style={{ boxShadow: `inset 0 0 ${state.acknowledged ? 40 : 90}px ${state.acknowledged ? 6 : 18}px ${info.color}${state.acknowledged ? '55' : 'aa'}` }}
        />
      )}

      {(state.active || sa.active) && (
        <div className="sticky top-[61px] z-30">
      {state.active && (
        <div role="alert" aria-live="assertive">
          <div className={cx('relative overflow-hidden bg-gradient-to-r shadow-[0_10px_40px_-10px_rgba(244,63,94,.6)] ring-1', style.bg, style.ring, style.text)}>
            <div className="alert-stripes pointer-events-none absolute inset-0 opacity-25" />
            <div className="relative mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/25">
                  {!state.acknowledged && <span className="ping-soft absolute inset-0 rounded-full bg-white/40" />}
                  <Siren className="relative h-6 w-6" />
                </span>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] opacity-90">Earthquake alert · {info.name} · MMI {info.mmi}</div>
                  <div className="text-[17px] font-extrabold leading-tight sm:text-xl">
                    {state.eta !== null ? <>Strong shaking expected in <span className="num">{Math.ceil(state.eta)} s</span>. Drop, cover, hold on.</> : info.action}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[12px] font-semibold sm:ml-auto">
                <Stat label="Shaking" value={`${state.value.toFixed(3)} g`} />
                <Stat label="Peak" value={`${state.peak.toFixed(3)} g`} />
                <Stat label="Duration" value={`${elapsed.toFixed(0)} s`} />
                <Stat label="Source" value={state.source ?? '—'} />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => alert.setSettings({ sound: !settings.sound })}
                  className="grid h-9 w-9 place-items-center rounded-lg bg-black/25 transition hover:bg-black/40"
                  title={settings.sound ? 'Mute alarm' : 'Unmute alarm'}
                  aria-label={settings.sound ? 'Mute alarm' : 'Unmute alarm'}
                >
                  {settings.sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>
                {!state.acknowledged ? (
                  <button onClick={alert.acknowledge} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[13px] font-bold text-ink-950 transition hover:bg-white/90">
                    <ShieldCheck className="h-4 w-4" />I'm safe
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 rounded-lg bg-black/25 px-3 py-2 text-[12px] font-semibold"><BellOff className="h-4 w-4" />Acknowledged</span>
                )}
                <button onClick={onOpen} className="flex items-center gap-1 rounded-lg bg-black/25 px-3 py-2 text-[13px] font-semibold transition hover:bg-black/40">
                  Details<ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* structural-stability alarm: its own colour, icon and klaxon */}
      {sa.active && (
        <div role="alert" aria-live="assertive" className="relative overflow-hidden bg-gradient-to-r from-violet-700/95 to-fuchsia-700/95 text-white shadow-[0_10px_40px_-10px_rgba(192,38,211,.6)] ring-1 ring-fuchsia-300/50">
          {sa.sounding && <div className="alert-stripes pointer-events-none absolute inset-0 opacity-20" />}
          <div className="relative mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-black/25">
                {sa.sounding && <span className="ping-soft absolute inset-0 rounded-xl bg-fuchsia-300/40" />}
                <Building2 className="relative h-5 w-5" />
              </span>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-fuchsia-100/90">Structural alarm · stability {sa.status.toLowerCase()}</div>
                <div className="text-[15px] font-extrabold leading-tight sm:text-[17px]">
                  {sa.tower}: stability margin down to <span className="num">{sa.stability.toFixed(0)}%</span>. {sa.status === 'Unstable' ? 'Collapse risk. Evacuate once shaking stops.' : 'Heavy damage likely. Keep clear and inspect before re-entry.'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 text-[12px] font-semibold sm:ml-auto">
              <Stat label="Worst floor" value={`F${sa.worstFloor}`} />
              <Stat label="P-Δ θ" value={sa.theta.toFixed(3)} />
              <Stat label="Source" value={sa.source ?? '—'} />
            </div>
            {!sa.acknowledged ? (
              <button onClick={alert.acknowledgeStructural} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[13px] font-bold text-violet-900 transition hover:bg-white/90">
                <BellOff className="h-4 w-4" />Silence
              </button>
            ) : (
              <span className="flex items-center gap-1.5 rounded-lg bg-black/25 px-3 py-2 text-[12px] font-semibold"><BellOff className="h-4 w-4" />Silenced</span>
            )}
          </div>
        </div>
      )}
        </div>
      )}

      {!state.active && clearVisible && (
        <div className="rise fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-2.5 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-ink-950 shadow-2xl ring-1 ring-emerald-300">
            <CheckCircle2 className="h-5 w-5" />All clear: shaking has stopped. Check for hazards before moving.
          </div>
        </div>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="leading-tight">
      <div className="text-[10px] uppercase tracking-wider opacity-75">{label}</div>
      <div className="num text-[13px]">{value}</div>
    </div>
  )
}
