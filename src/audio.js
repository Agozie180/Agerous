/**
 * AGEROUS — procedural soundscape (Web Audio, zero audio files)
 *
 * Reads world state and mixes rain, wind, river and thunder layers; adds a church bell for
 * services and shelters, a rising alert tone for flood warnings and small UI blips.
 * Browsers only allow audio after a user gesture, so the context is created lazily on the first
 * pointer/key press. The mute choice is remembered. Nothing here touches the simulation.
 */
import { weatherOf, isRaining } from './simulation/hazard.js';

const KEY = 'agerous.sound';

export class Soundscape {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem(KEY) === 'off'; } catch { /* storage blocked */ }
    this._alert = 0; this._bell = false; this._started = false;
    const wake = () => { this._start(); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, wake, { once: false, passive: true });
  }

  get supported() { return typeof (window.AudioContext || window.webkitAudioContext) === 'function'; }

  _start() {
    if (this._started || !this.supported) return;
    this._started = true;
    const C = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.55; this.master.connect(ctx.destination);

    // one second of white noise, looped, shared by every noisy layer
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.97 * b0 + 0.03 * w; d[i] = w * 0.5 + b0 * 4; }   // a little pinkish
    this.noise = buf;

    const layer = (type, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return { f, g };
    };
    this.rain = layer('highpass', 1800);
    this.wind = layer('bandpass', 380, 0.6);
    this.river = layer('lowpass', 420);
    // slow gusts: an LFO wobbling the wind filter
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.13; lg.gain.value = 140;
    lfo.connect(lg); lg.connect(this.wind.f.frequency); lfo.start();
    if (ctx.state === 'suspended') ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem(KEY, m ? 'off' : 'on'); } catch { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.08);
    if (!m) this._start();
  }

  /** Call every frame. */
  update(world) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, w = weatherOf(world);
    const rainLevel = !isRaining(world) ? 0 : world.env.peak >= 1.5 ? 0.5 : 0.28;
    const windLevel = w === 'storm' ? 0.34 : w === 'rain' ? 0.16 : w === 'drizzle' ? 0.07 : w === 'cloudy' ? 0.05 : 0.025;
    const riverLevel = Math.min(0.32, 0.04 + Math.max(0, world.env.stage) * 0.11);
    const slow = world.timeSpeed > 40 ? 0.35 : 1;                 // hush the weather when time is racing
    this.rain.g.gain.setTargetAtTime(rainLevel * slow, t, 0.6);
    this.wind.g.gain.setTargetAtTime(windLevel * slow, t, 0.8);
    this.river.g.gain.setTargetAtTime(riverLevel * slow, t, 0.8);

    const alert = world.institutions.civil.alert;
    if (alert > this._alert) this.alertTone(alert);
    this._alert = alert;
    const bell = !!(world.institutions.church.service?.begun) || world.institutions.civil.shelters.includes('church');
    if (bell && !this._bell && world.timeSpeed <= 40) this.bell();
    this._bell = bell;
  }

  _env(node, peak, attack, release, t0 = this.ctx.currentTime) {
    const g = node.gain; g.cancelScheduledValues(t0); g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + attack); g.exponentialRampToValueAtTime(0.0001, t0 + attack + release);
  }

  /** Thunder rolls in after the flash: low-passed noise with a long tail. */
  thunder() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, delay = 0.25 + Math.random() * 1.4, t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(520, t0); f.frequency.exponentialRampToValueAtTime(70, t0 + 2.6);
    const g = ctx.createGain(); src.connect(f); f.connect(g); g.connect(this.master);
    this._env(g, 0.9, 0.05, 2.8, t0); src.start(t0); src.stop(t0 + 3.2);
  }

  bell() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    [[392, 0.34], [784, 0.14], [1176, 0.07], [1568, 0.04]].forEach(([hz, v]) => {
      for (let k = 0; k < 3; k++) {                              // three strokes
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = hz * (1 + (k ? 0.001 * k : 0));
        o.connect(g); g.connect(this.master); this._env(g, v, 0.01, 2.2, t0 + k * 1.15); o.start(t0 + k * 1.15); o.stop(t0 + k * 1.15 + 2.4);
      }
    });
  }

  /** Two-tone rising warning; more beats for a higher alert level. */
  alertTone(level) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime, beats = Math.min(3, level);
    for (let i = 0; i < beats; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle';
      o.frequency.setValueAtTime(520, t0 + i * 0.5); o.frequency.linearRampToValueAtTime(760, t0 + i * 0.5 + 0.22);
      o.connect(g); g.connect(this.master); this._env(g, 0.16, 0.03, 0.4, t0 + i * 0.5); o.start(t0 + i * 0.5); o.stop(t0 + i * 0.5 + 0.5);
    }
  }

  /** Interface feedback: accepted (rising) or rejected (low). */
  blip(ok = true) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(ok ? 520 : 200, t0); o.frequency.exponentialRampToValueAtTime(ok ? 880 : 150, t0 + 0.12);
    o.connect(g); g.connect(this.master); this._env(g, 0.2, 0.01, 0.18, t0); o.start(t0); o.stop(t0 + 0.25);
  }
}
