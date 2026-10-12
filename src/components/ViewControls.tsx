import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minus, MousePointer2, Plus } from 'lucide-react'
import type { CameraApi } from './TowerScene'
import { cx } from './ui'

/** Zoom / reset buttons on the right edge of a 3D viewport, plus a hint that fades after first use. */
export function useViewControls() {
  const cameraApi = useRef<CameraApi | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [interacted, setInteracted] = useState(false)
  return {
    cameraApi,
    resetKey,
    reset: () => setResetKey((k) => k + 1),
    interacted,
    onInteract: () => setInteracted(true),
  }
}

export default function ViewControls({ v, bottom = 76 }: { v: ReturnType<typeof useViewControls>; bottom?: number }) {
  const [showHint, setShowHint] = useState(true)
  useEffect(() => {
    if (v.interacted) { const id = setTimeout(() => setShowHint(false), 600); return () => clearTimeout(id) }
  }, [v.interacted])

  const btn = 'grid h-9 w-9 place-items-center text-slate-200 transition hover:bg-white/10 hover:text-white active:scale-95'
  return (
    <>
      <div className="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-ink-950/80 ring-1 ring-white/10 backdrop-blur-md sm:right-4">
        <button className={btn} title="Zoom in" aria-label="Zoom in" onClick={() => v.cameraApi.current?.zoom(0.7)}><Plus className="h-4 w-4" /></button>
        <div className="h-px bg-white/10" />
        <button className={btn} title="Zoom out" aria-label="Zoom out" onClick={() => v.cameraApi.current?.zoom(1.4)}><Minus className="h-4 w-4" /></button>
        <div className="h-px bg-white/10" />
        <button className={btn} title="Reset view (double-click)" aria-label="Reset view" onClick={v.reset}><Maximize2 className="h-4 w-4" /></button>
      </div>
      <div
        className={cx('pointer-events-none absolute left-1/2 z-10 hidden -translate-x-1/2 transition-opacity duration-500 sm:block', showHint ? 'opacity-100' : 'opacity-0')}
        style={{ bottom }}
      >
        <div className="flex items-center gap-2 whitespace-nowrap rounded-full bg-ink-950/80 px-3.5 py-1.5 text-[11.5px] text-slate-300 ring-1 ring-white/10 backdrop-blur-md">
          <MousePointer2 className="h-3.5 w-3.5 text-sky-300" />
          <span><b className="text-white">Drag</b> rotate</span><span className="text-slate-600">·</span>
          <span><b className="text-white">Scroll</b> zoom to cursor</span><span className="text-slate-600">·</span>
          <span><b className="text-white">Right-drag</b> pan</span><span className="text-slate-600">·</span>
          <span><b className="text-white">Double-click</b> reset</span>
        </div>
      </div>
    </>
  )
}
