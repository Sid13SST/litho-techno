import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { Check, CircleDot, Copy, Cpu, Download, Plug, PlugZap, Square, Trash2, Usb, Zap } from 'lucide-react'
import { useSensorBench, convert, UNIT_LABEL, type Unit } from '../hooks/useSensorBench'
import { SensorChart } from './charts'
import { Badge, Button, Segmented, Slider, cx } from './ui'
import { intensityLabel, pgaFromMagnitude } from '../sim/ground'
import { driftLevel, reduction } from '../sim/engine'
import { SensorEngine } from '../sim/sensorEngine'
import FloorMonitor from './FloorMonitor'
import ViewControls, { useViewControls } from './ViewControls'
import SeismicAlertStrip from './AlertPanel'
import type { AlertMonitor } from '../alerts/useAlertMonitor'
import type { ColorMode, ViewMode } from './TowerScene'

const TowerScene = lazy(() => import('./TowerScene'))

export const ARDUINO_SKETCH = `/*
  SeismoShield test bench - Arduino Uno R3 + 2x MPU-6050 (GY-521)
  Sensor 1 (0x68, AD0 -> GND) : roof of the model WITHOUT damper
  Sensor 2 (0x69, AD0 -> 5V)  : roof of the model WITH damper
  Output: "a1,a2\\n" lateral acceleration in g at ~100 Hz, 115200 baud.
  Works with a single sensor too (prints one value per line).
*/
#include <Wire.h>

const uint8_t ADDR[2] = {0x68, 0x69};
const float LSB_PER_G = 16384.0;   // +/-2 g range
const float ALPHA = 0.35;          // low-pass smoothing (0..1, higher = faster)
bool ok[2];
float offset[2], filt[2];

bool wake(uint8_t a) {
  Wire.beginTransmission(a);
  if (Wire.endTransmission() != 0) return false;
  Wire.beginTransmission(a); Wire.write(0x6B); Wire.write(0x00); Wire.endTransmission(); // PWR_MGMT_1: wake
  Wire.beginTransmission(a); Wire.write(0x1A); Wire.write(0x03); Wire.endTransmission(); // DLPF ~44 Hz
  return true;
}

float readX(uint8_t a) {                      // ACCEL_XOUT_H/L
  Wire.beginTransmission(a); Wire.write(0x3B); Wire.endTransmission(false);
  Wire.requestFrom(a, (uint8_t)2);
  int16_t raw = (Wire.read() << 8) | Wire.read();
  return raw / LSB_PER_G;
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  Wire.setClock(400000);
  delay(100);
  for (int s = 0; s < 2; s++) {
    ok[s] = wake(ADDR[s]);
    if (!ok[s]) continue;
    float sum = 0;                            // zero-calibrate while the table is still
    for (int i = 0; i < 200; i++) { sum += readX(ADDR[s]); delay(2); }
    offset[s] = sum / 200.0;
  }
  Serial.println(ok[1] ? "# dual sensor mode" : "# single sensor mode");
}

void loop() {
  static unsigned long next = 0;
  if (millis() < next) return;
  next = millis() + 10;                       // 100 Hz
  for (int s = 0; s < 2; s++)
    if (ok[s]) filt[s] += ALPHA * ((readX(ADDR[s]) - offset[s]) - filt[s]);
  Serial.print(filt[0], 4);
  if (ok[1]) { Serial.print(','); Serial.print(filt[1], 4); }
  Serial.println();
}
`

const WIRING = [
  ['VCC', '5V', 'Both sensors (GY-521 has an onboard 3.3 V regulator)'],
  ['GND', 'GND', 'Common ground'],
  ['SDA', 'A4', 'Shared I²C data line'],
  ['SCL', 'A5', 'Shared I²C clock line'],
  ['AD0 (sensor 1)', 'GND', 'Address 0x68: tower without damper'],
  ['AD0 (sensor 2)', '5V', 'Address 0x69: tower with damper'],
]

export default function Bench({ s, alert }: { s: ReturnType<typeof useSensorBench>; alert: AlertMonitor }) {
  const [copied, setCopied] = useState(false)
  const engine = useMemo(() => new SensorEngine(s.sample), [s.sample])
  const [view, setView] = useState<ViewMode>('front')
  const [colorMode, setColorMode] = useState<ColorMode>('live')
  const vc = useViewControls()
  const exagRef = useRef(6)
  const colorRef = useRef(colorMode)
  colorRef.current = colorMode
  const active = s.connected || s.demo
  const startTest = () => { engine.resetMetrics(); s.start() }
  const peakOf = (arr: number[]) => arr.reduce((m, v) => (Number.isNaN(v) ? m : Math.max(m, Math.abs(v))), 0)
  const unit = UNIT_LABEL[s.unit]
  const a = convert(s.live.a, s.unit)
  const b = convert(s.live.b, s.unit)
  const pga = pgaFromMagnitude(s.magnitude)
  const results = Object.values(s.results).sort((x, y) => x.magnitude - y.magnitude)

  const copy = async () => {
    try { await navigator.clipboard.writeText(ARDUINO_SKETCH); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked */ }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([ARDUINO_SKETCH], { type: 'text/plain' }))
    const el = document.createElement('a')
    el.href = url; el.download = 'seismoshield_bench.ino'; el.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        {/* status bar */}
        <div className="panel flex flex-wrap items-center gap-3 p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className={cx('grid h-10 w-10 place-items-center rounded-xl ring-1', s.connected ? 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/30' : 'bg-sky-400/10 text-sky-300 ring-sky-400/25')}>
              {s.connected ? <Usb className="h-5 w-5" /> : <Cpu className="h-5 w-5" />}
            </div>
            <div>
              <div className="text-sm font-semibold text-white">{s.connected ? 'Arduino Uno R3 connected' : s.demo ? 'Virtual shake table (simulated)' : 'No sensor connected'}</div>
              <div className="num text-[11.5px] text-slate-400">
                {s.connected ? `${s.dual ? 'Dual MPU-6050 (0x68 + 0x69)' : 'Single MPU-6050 (0x68)'} · ${s.rate} Hz` : s.demo ? `Simulated sensors · ${s.rate} Hz` : 'Plug in the Uno over USB and press Connect'}
              </div>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {s.recording ? <Badge tone="bad"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />Recording</Badge> : <Badge tone="muted">Idle</Badge>}
            {!s.connected ? (
              <>
                <select value={s.baud} onChange={(e) => s.setBaud(Number(e.target.value))} className="rounded-xl bg-white/5 px-2.5 py-2 text-[13px] text-slate-200 ring-1 ring-white/10 outline-none" aria-label="Baud rate">
                  {[9600, 57600, 115200].map((r) => <option key={r} value={r} className="bg-ink-900">{r} baud</option>)}
                </select>
                <Button variant="primary" onClick={s.connect}><Plug className="h-4 w-4" />Connect Arduino</Button>
              </>
            ) : (
              <Button onClick={s.disconnect}><PlugZap className="h-4 w-4" />Disconnect</Button>
            )}
          </div>
        </div>
        {s.error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-[13px] text-rose-200 ring-1 ring-rose-400/30">{s.error}</div>}

        {/* 3D view driven by the sensors */}
        <div className="panel relative overflow-hidden p-0" style={{ height: 'min(64vh, 580px)', minHeight: 420 }}>
          <Suspense fallback={<div className="grid h-full place-items-center text-sm text-slate-500">Loading 3D engine…</div>}>
            <TowerScene engine={engine} exaggeration={exagRef} colorMode={colorRef} view={view} resetKey={vc.resetKey} onReset={vc.reset} onInteract={vc.onInteract} cameraApi={vc.cameraApi} />
          </Suspense>
          <ViewControls v={vc} />
          <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3 sm:inset-x-4 sm:top-4">
            <SensorCard kind="bare" title="Sensor 1 · no damper" value={a} unit={unit} peak={convert(peakOf(s.buf.current.a), s.unit)} idr={engine.mBare.peakIdr} on={active} />
            <div className="hidden md:block">
              {s.connected ? <Badge tone="ok"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />Live Arduino data</Badge>
                : s.demo ? <Badge tone="warn">Simulated data</Badge> : <Badge tone="muted">No sensor</Badge>}
            </div>
            <SensorCard kind="tmd" title="Sensor 2 · with damper" value={s.dual ? b : NaN} unit={unit} peak={convert(peakOf(s.buf.current.b), s.unit)} idr={engine.mTmd.peakIdr} on={active && s.dual} />
          </div>
          {!active && (
            <div className="absolute inset-0 grid place-items-center bg-ink-950/60 p-4 backdrop-blur-[2px]">
              <div className="rise w-full max-w-md rounded-3xl bg-ink-900/95 p-6 text-center ring-1 ring-white/10">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/25"><Usb className="h-6 w-6" /></div>
                <h3 className="mt-3 text-lg font-semibold text-white">No sensor connected</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-400">Connect the Arduino to drive these towers with your real MPU-6050 readings, or try the virtual shake table (simulated data).</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button variant="primary" onClick={s.connect}><Plug className="h-4 w-4" />Connect Arduino</Button>
                  <Button onClick={() => s.setDemo(true)}><Zap className="h-4 w-4 text-amber-300" />Use virtual shake table</Button>
                </div>
              </div>
            </div>
          )}
          <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2 sm:inset-x-4 sm:bottom-4">
            <div className="hidden max-w-[340px] rounded-xl bg-ink-950/80 px-3 py-2 text-[11.5px] leading-snug text-slate-400 ring-1 ring-white/10 backdrop-blur md:block">Towers mirror the measured roof acceleration, scaled to a 72 m prototype. Pendulum motion is estimated from sensor 2.</div>
            <div className="flex gap-2">
              <div className="w-[176px] rounded-xl bg-ink-950/80 p-1 ring-1 ring-white/10"><Segmented size="sm" value={view} onChange={setView} options={[{ value: 'front', label: 'Front' }, { value: 'tmd', label: 'Damper' }, { value: 'orbit', label: 'Orbit' }]} /></div>
              <div className="hidden w-[190px] rounded-xl bg-ink-950/80 p-1 ring-1 ring-white/10 sm:block"><Segmented<ColorMode> size="sm" value={colorMode} onChange={setColorMode} options={[{ value: 'live', label: 'Live drift' }, { value: 'damage', label: 'Damage' }]} /></div>
            </div>
          </div>
        </div>

        {/* live graph */}
        <div className="panel flex h-[340px] flex-col p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="label">Roof acceleration · live</div>
              {s.connected ? <Badge tone="ok">Arduino</Badge> : s.demo ? <Badge tone="warn">Simulated</Badge> : <Badge tone="muted">No data</Badge>}
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-3 text-xs text-slate-400 sm:flex">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-bare" />No damper</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-tmd" />With damper</span>
              </span>
              <div className="w-[200px]"><Segmented<Unit> size="sm" value={s.unit} onChange={s.setUnit} options={[{ value: 'g', label: 'g' }, { value: 'ms2', label: 'm/s²' }, { value: 'deg', label: 'tilt °' }]} /></div>
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <SensorChart unit={unit} getData={() => {
              const B = s.buf.current
              return { t: B.t, a: B.a.map((v) => convert(v, s.unit)), b: B.b.map((v) => (Number.isNaN(v) ? NaN : convert(v, s.unit))) }
            }} />
            {!active && <div className="absolute inset-0 grid place-items-center text-sm text-slate-500">Waiting for a sensor. Nothing is plotted until data arrives.</div>}
          </div>
          <div className="mt-2 flex items-center gap-2 overflow-hidden rounded-lg bg-ink-950/70 px-3 py-1.5 font-mono text-[11.5px] ring-1 ring-white/5">
            <span className="text-slate-600">serial&gt;</span>
            <span className="truncate text-emerald-300">{s.connected ? (s.lastLine || 'waiting for data…') : s.demo ? '(simulated, no serial port open)' : 'not connected'}</span>
          </div>
        </div>

        <SeismicAlertStrip
          alert={alert}
          title="Sensor shaking · seismic detection"
          getTrace={() => {
            // strongest of the two sensors, keeping its sign, so the trace matches what the alert monitor sees
            const B = s.buf.current
            const v = B.a.map((a, i) => (Number.isNaN(B.b[i]) || Math.abs(a) >= Math.abs(B.b[i]) ? a : B.b[i]))
            return { t: B.t, v, n: B.t.length, tNow: B.t.length ? B.t[B.t.length - 1] : 0 }
          }}
        />

        {active && <FloorMonitor engine={engine} />}

        {/* results */}
        <div className="panel p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="label">Test results by magnitude</div>
              <p className="mt-1 text-[12.5px] text-slate-400">Each recorded test is saved in this browser. Reduction = (no damper − with damper) / no damper, on peak acceleration.</p>
            </div>
            {results.length > 0 && <Button onClick={s.clearResults}><Trash2 className="h-4 w-4" />Clear</Button>}
          </div>
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">
              No tests yet. Pick a magnitude, press <span className="font-semibold text-slate-300">Start test</span>, then <span className="font-semibold text-slate-300">Stop &amp; save</span>.
            </div>
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="pb-2 font-semibold">Magnitude</th>
                    <th className="pb-2 text-right font-semibold">Peak · no damper</th>
                    <th className="pb-2 text-right font-semibold">Peak · damper</th>
                    <th className="pb-2 text-right font-semibold">Peak-to-peak</th>
                    <th className="pb-2 pl-4 font-semibold">Reduction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {results.map((r) => {
                    const red = r.peakB > 0 ? reduction(r.peakA, r.peakB) : NaN
                    return (
                      <tr key={r.magnitude}>
                        <td className="py-2.5"><span className="num font-semibold text-amber-300">M{r.magnitude.toFixed(1)}</span> <span className="text-[11px] text-slate-500">{r.source === 'demo' ? 'virtual' : 'arduino'} · {r.duration.toFixed(0)}s</span></td>
                        <td className="num py-2.5 text-right text-rose-200">{convert(r.peakA, s.unit).toFixed(3)} {unit}</td>
                        <td className="num py-2.5 text-right text-sky-200">{r.peakB > 0 ? `${convert(r.peakB, s.unit).toFixed(3)} ${unit}` : '—'}</td>
                        <td className="num py-2.5 text-right text-slate-400">{convert(r.p2pA, s.unit).toFixed(2)} / {r.p2pB > 0 ? convert(r.p2pB, s.unit).toFixed(2) : '—'}</td>
                        <td className="py-2.5 pl-4">
                          {Number.isNaN(red) ? <span className="text-slate-500">single sensor</span> : (
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-24 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300" style={{ width: `${Math.max(0, Math.min(100, red))}%` }} /></div>
                              <span className={cx('num font-bold', red >= 0 ? 'text-emerald-400' : 'text-rose-400')}>{red.toFixed(0)}%</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* side panel */}
      <aside className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
        <div className="panel space-y-4 p-5">
          <div className="label">Run a test</div>
          <Slider label="Test magnitude" value={s.magnitude} min={4} max={8} step={0.5} accent="#fbbf24" onChange={s.setMagnitude} display={<span className="text-amber-300">M {s.magnitude.toFixed(1)}</span>} hint={s.connected ? 'Label only: set your physical shake table to match.' : <>Virtual table drives PGA ≈ {pga.toFixed(2)} g · MMI {intensityLabel(pga).mmi}</>} />
          {!s.recording ? (
            <Button variant="success" className="w-full py-2.5" onClick={startTest} disabled={!active}><CircleDot className="h-4 w-4" />Start test</Button>
          ) : (
            <Button variant="danger" className="w-full py-2.5" onClick={s.stop}><Square className="h-4 w-4" fill="currentColor" />Stop &amp; save</Button>
          )}
          <div className="grid grid-cols-3 gap-2">
            <Button onClick={s.doTare} title="Use the current reading as zero">Tare</Button>
            <Button onClick={s.resetTare}>Untare</Button>
            <Button onClick={s.clearGraph}>Clear</Button>
          </div>
          {!s.connected && (
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-ink-950/50 px-3 py-2.5 text-[13px] text-slate-300 ring-1 ring-white/8">
              <span className="flex items-center gap-2"><Zap className="h-4 w-4 text-amber-300" />Virtual shake table <span className="text-[11px] text-slate-500">(simulated)</span></span>
              <input type="checkbox" checked={s.demo} onChange={(e) => s.setDemo(e.target.checked)} className="h-4 w-4 accent-sky-400" />
            </label>
          )}
        </div>

        <div className="panel p-5">
          <div className="label mb-3">Wiring · Uno R3 ↔ MPU-6050</div>
          <div className="space-y-1.5">
            {WIRING.map(([pin, to, note]) => (
              <div key={pin} className="grid grid-cols-[96px_14px_40px_1fr] items-center gap-1.5 text-[12px]">
                <span className="num font-semibold text-sky-300">{pin}</span>
                <span className="text-slate-600">→</span>
                <span className="num font-semibold text-amber-300">{to}</span>
                <span className="text-slate-500">{note}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="label">Arduino sketch</div>
            <div className="flex gap-1.5">
              <Button className="px-2.5 py-1.5" onClick={copy} title="Copy sketch">{copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}</Button>
              <Button className="px-2.5 py-1.5" onClick={download} title="Download .ino"><Download className="h-4 w-4" /></Button>
            </div>
          </div>
          <pre className="scroll-thin max-h-64 overflow-auto rounded-xl bg-ink-950/80 p-3 text-[11px] leading-relaxed text-slate-300 ring-1 ring-white/5"><code>{ARDUINO_SKETCH}</code></pre>
          <p className="mt-2 text-[11.5px] text-slate-500">No libraries needed. Also accepts JSON lines like {'{"b1":0.1,"b2":0.03}'} and raw MPU counts.</p>
        </div>
      </aside>
    </div>
  )
}

function SensorCard({ kind, title, value, unit, peak, idr, on }: { kind: 'bare' | 'tmd'; title: string; value: number; unit: string; peak: number; idr: number; on: boolean }) {
  const level = driftLevel(idr)
  return (
    <div className={cx('w-[150px] rounded-2xl bg-ink-950/75 p-3 ring-1 backdrop-blur-md sm:w-[200px]', kind === 'bare' ? 'ring-rose-400/25' : 'text-right ring-sky-400/30')}>
      <div className={cx('flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider', kind === 'bare' ? 'text-bare' : 'flex-row-reverse text-tmd')}>
        <span className={cx('h-2 w-2 rounded-full', kind === 'bare' ? 'bg-bare' : 'bg-tmd')} />{title}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5" style={{ justifyContent: kind === 'tmd' ? 'flex-end' : 'flex-start' }}>
        <span className="num text-xl font-bold text-white sm:text-2xl">{on && !Number.isNaN(value) ? value.toFixed(3) : '—'}</span>
        <span className="text-xs text-slate-400">{unit}</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-400">{on ? <>peak <span className="num text-slate-200">{peak.toFixed(3)} {unit}</span></> : kind === 'tmd' ? 'sensor 2 not detected' : 'no data'}</div>
      {on && idr > 0 && <div className={cx('mt-2 hidden sm:flex', kind === 'tmd' && 'justify-end')}><Badge tone={level.tone}>{level.label}</Badge></div>}
    </div>
  )
}
