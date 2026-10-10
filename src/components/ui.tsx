import type { ReactNode } from 'react'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

export function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  display: ReactNode
  hint?: ReactNode
  accent?: string
}) {
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-slate-300">{props.label}</span>
        <span className="num text-[13px] font-semibold text-white">{props.display}</span>
      </div>
      <input
        type="range"
        className="slider mt-1.5"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
        style={{ ['--pct' as string]: `${pct}%`, ['--accent' as string]: props.accent ?? '#38bdf8' }}
      />
      {props.hint && <div className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{props.hint}</div>}
    </label>
  )
}

export function Segmented<T extends string | number>(props: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex w-full rounded-xl border border-white/8 bg-ink-950/70 p-1">
      {props.options.map((o) => {
        const active = o.value === props.value
        return (
          <button
            key={String(o.value)}
            title={o.title}
            onClick={() => props.onChange(o.value)}
            className={cx(
              'flex-1 rounded-lg font-medium transition-all',
              props.size === 'sm' ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-[13px]',
              active ? 'bg-white text-ink-950 shadow' : 'text-slate-400 hover:text-white',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; sub?: ReactNode }) {
  return (
    <button
      onClick={() => props.onChange(!props.checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/8 bg-ink-950/50 px-3 py-2.5 text-left transition hover:border-white/15"
      role="switch"
      aria-checked={props.checked}
    >
      <span>
        <span className="block text-[13px] font-semibold text-white">{props.label}</span>
        {props.sub && <span className="block text-[11.5px] text-slate-500">{props.sub}</span>}
      </span>
      <span className={cx('relative h-6 w-11 shrink-0 rounded-full transition', props.checked ? 'bg-tmd' : 'bg-ink-600')}>
        <span className={cx('absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all', props.checked ? 'left-6' : 'left-1')} />
      </span>
    </button>
  )
}

export function Section(props: { title: string; icon?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-3.5">
      <div className="flex items-center justify-between">
        <div className="label flex items-center gap-2">{props.icon}{props.title}</div>
        {props.aside}
      </div>
      {props.children}
    </section>
  )
}

export function Badge(props: { tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted'; children: ReactNode; className?: string }) {
  const tones = {
    ok: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25',
    warn: 'bg-amber-400/10 text-amber-300 ring-amber-400/25',
    bad: 'bg-rose-500/10 text-rose-300 ring-rose-400/30',
    info: 'bg-sky-400/10 text-sky-300 ring-sky-400/25',
    muted: 'bg-white/5 text-slate-400 ring-white/10',
  }
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset', tones[props.tone], props.className)}>
      {props.children}
    </span>
  )
}

export function Button(props: {
  onClick?: () => void
  children: ReactNode
  variant?: 'primary' | 'ghost' | 'danger' | 'success'
  className?: string
  disabled?: boolean
  title?: string
}) {
  const v = {
    primary: 'bg-white text-ink-950 hover:bg-sky-100',
    ghost: 'bg-white/5 text-slate-200 ring-1 ring-inset ring-white/10 hover:bg-white/10',
    danger: 'bg-rose-500 text-white hover:bg-rose-400',
    success: 'bg-emerald-500 text-ink-950 hover:bg-emerald-400',
  }[props.variant ?? 'ghost']
  return (
    <button
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cx('inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40', v, props.className)}
    >
      {props.children}
    </button>
  )
}

export function fmt(v: number, d = 2) {
  return Number.isFinite(v) ? v.toFixed(d) : '—'
}
