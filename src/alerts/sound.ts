/**
 * Alarm tones synthesised with Web Audio (no audio files).
 * 1 Advisory: soft two-note chime · 2 Warning: urgent triple beep · 3 Severe: rising/falling siren.
 * Browsers only allow audio after a user gesture, so call unlock() from any click.
 */
export class AlertSound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private level = 0
  private timer: number | null = null
  private siren: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null
  private volume = 0.6

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        this.ctx = new AC()
        this.master = this.ctx.createGain()
        this.master.gain.value = this.volume
        this.master.connect(this.ctx.destination)
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch { /* audio unavailable */ }
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running' }

  setVolume(v: number) {
    this.volume = v
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05)
  }

  /** start (or switch to) the pattern for a level; 0 stops */
  play(level: number) {
    if (level === this.level) return
    this.stop()
    this.level = level
    if (!level) return
    this.unlock()
    if (!this.ctx) return
    if (level === 1) { this.chime(); this.timer = window.setInterval(() => this.chime(), 3500) }
    else if (level === 2) { this.triple(); this.timer = window.setInterval(() => this.triple(), 1400) }
    else this.startSiren()
  }

  /* ---- structural-stability alarm: a separate channel with a low "BAH-bah" klaxon ---- */
  private structTimer: number | null = null

  playStructural(on: boolean) {
    if (on === (this.structTimer !== null)) return
    if (!on) { clearInterval(this.structTimer!); this.structTimer = null; return }
    this.unlock()
    if (!this.ctx) return
    this.klaxon()
    this.structTimer = window.setInterval(() => this.klaxon(), 1150)
  }

  private klaxon() {
    if (!this.ctx || !this.master) return
    const ctx = this.ctx
    const t = ctx.currentTime + 0.02
    // two low horn blasts, each a pair of slightly detuned square waves through a low-pass (buzzy, horn-like)
    for (const [start, f, dur] of [[0, 392, 0.42], [0.5, 294, 0.42]] as const) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 1300
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t + start)
      g.gain.exponentialRampToValueAtTime(0.16, t + start + 0.03)
      g.gain.setValueAtTime(0.16, t + start + dur - 0.06)
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur)
      filter.connect(g).connect(this.master)
      for (const detune of [-8, 8]) {
        const osc = ctx.createOscillator()
        osc.type = 'square'
        osc.frequency.value = f
        osc.detune.value = detune
        osc.connect(filter)
        osc.start(t + start)
        osc.stop(t + start + dur + 0.05)
      }
    }
  }

  stop() {
    this.level = 0
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null }
    this.stopSiren()
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, peak: number) {
    const ctx = this.ctx!, out = this.master!
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(peak, start + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    osc.connect(g).connect(out)
    osc.start(start)
    osc.stop(start + dur + 0.05)
  }

  private chime() {
    const t = this.ctx!.currentTime + 0.02
    this.tone(659.25, t, 0.9, 'sine', 0.5)
    this.tone(523.25, t + 0.32, 1.1, 'sine', 0.45)
  }

  private triple() {
    const t = this.ctx!.currentTime + 0.02
    for (let i = 0; i < 3; i++) {
      this.tone(988, t + i * 0.2, 0.14, 'square', 0.22)
      this.tone(1976, t + i * 0.2, 0.1, 'sine', 0.08)
    }
  }

  private startSiren() {
    if (this.siren || !this.ctx) return
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = 900
    const lfo = ctx.createOscillator() // sweeps the pitch 600 ↔ 1200 Hz
    lfo.frequency.value = 0.9
    const depth = ctx.createGain()
    depth.gain.value = 300
    lfo.connect(depth).connect(osc.frequency)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 2400
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.15)
    osc.connect(filter).connect(gain).connect(this.master!)
    osc.start(); lfo.start()
    this.siren = { osc, lfo, gain }
  }

  private stopSiren() {
    const s = this.siren
    if (!s || !this.ctx) return
    const t = this.ctx.currentTime
    s.gain.gain.cancelScheduledValues(t)
    s.gain.gain.setTargetAtTime(0.0001, t, 0.06)
    s.osc.stop(t + 0.4); s.lfo.stop(t + 0.4)
    this.siren = null
  }
}

export const alertSound = new AlertSound()
