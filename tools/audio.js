/**
 * AudioFX — tiny Web Audio synth for The Bellmore
 *
 * KEY DESIGN RULES (why previous version was silent):
 *  1. AudioContext must NOT be created at script-load time — browsers block it
 *     outside a user gesture. We create it lazily on the first play call.
 *  2. ctx.currentTime must always come from a live context. Returning 0 as a
 *     fallback schedules sounds in the past; the browser drops them silently.
 *  3. All play functions await ctx.resume() before scheduling, so they work
 *     even if the context is still suspended when the gesture fires.
 */

(function () {
  'use strict';

  let ctx = null;
  let master = null;
  let _noiseBuffer = null;
  let _vol = 0.325;

  /* ── Context bootstrap ── */

  function getCtx() {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = _vol;
      master.connect(ctx.destination);
    }
    return ctx;
  }

  // Always use the live currentTime — never a 0 fallback.
  function now() { return ctx ? ctx.currentTime : 0; }

  // Resume if suspended (returns a Promise).
  function ready() {
    const c = getCtx();
    if (!c) return Promise.reject('No AudioContext');
    return c.state === 'suspended' ? c.resume() : Promise.resolve();
  }

  /* ── Helpers ── */

  function makeOsc(type, freq) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  function makeGain(val) {
    const g = ctx.createGain();
    g.gain.value = val != null ? val : 1;
    return g;
  }

  function noiseBuffer() {
    if (_noiseBuffer) return _noiseBuffer;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 0.5);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    _noiseBuffer = buf;
    return buf;
  }

  /* ── Sounds ── */

  /**
   * Desk bell — bright sine partials, quick attack, warm ring.
   * Great for: guest check-in, positive result, shop purchase.
   */
  function _ding(t, freq) {
    // Single counter-bell strike: fundamental + metallic partials
    // + a detuned "rattle" oscillator slightly off-pitch for clanginess.
    const env = makeGain(0);

    // WaveShaper for mild clipping — gives the rattly metallic bite
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      curve[i] = (Math.PI + 60) * x / (Math.PI + 60 * Math.abs(x)); // soft clip
    }
    shaper.curve = curve;
    shaper.oversample = '4x';

    env.connect(shaper);
    shaper.connect(master);

    const o1 = makeOsc('sine',     freq);           // fundamental
    const o2 = makeOsc('sine',     freq * 2.756);   // metallic partial
    const o3 = makeOsc('triangle', freq * 5.405);   // high shimmer
    const o4 = makeOsc('sine',     freq * 1.0083);  // barely detuned rattle twin

    const m1 = makeGain(0.60); o1.connect(m1); m1.connect(env);
    const m2 = makeGain(0.20); o2.connect(m2); m2.connect(env);
    const m3 = makeGain(0.06); o3.connect(m3); m3.connect(env);
    const m4 = makeGain(0.18); o4.connect(m4); m4.connect(env); // beating rattle

    const crack  = t + 0.001;
    const settle = t + 0.018;
    const ring   = t + 1.1;
    const tail   = ring + 0.04; // ramp to silence before stop — prevents click
    env.gain.setValueAtTime(0,      t);
    env.gain.linearRampToValueAtTime(0.65,  crack);
    env.gain.exponentialRampToValueAtTime(0.16, settle);
    env.gain.exponentialRampToValueAtTime(0.0001, ring);
    env.gain.linearRampToValueAtTime(0, tail);

    [o1, o2, o3, o4].forEach(function (o) { o.start(t); o.stop(tail + 0.01); });
  }

  function playBell(opts) {
    opts = opts || {};
    ready().then(function () {
      const freq = opts.freq || 2637; // E7 — high, bright counter bell
      const t = now();
      _ding(t, freq);
      _ding(t + 0.18, freq); // same pitch both hits — pure ding-ding
    }).catch(function () {});
  }

  /**
   * Ghost whisper — slow-attack eerie sine pad with a wobble LFO.
   * Great for: ghost interactions, haunt events.
   */
  function playGhost(opts) {
    opts = opts || {};
    ready().then(function () {
      const t = now();
      const base = opts.freq || 196;

      const env = makeGain(0);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 520;
      bp.Q.value = 1.2;
      env.connect(bp);
      bp.connect(master);

      const o1 = makeOsc('sine', base);
      const o2 = makeOsc('sine', base * 1.503);
      o1.connect(env);
      o2.connect(env);

      const lfo = makeOsc('sine', 0.45);
      const lfoAmt = makeGain(4);
      lfo.connect(lfoAmt);
      lfoAmt.connect(o1.frequency);
      lfoAmt.connect(o2.frequency);

      const atk  = t + 0.18;
      const peak = t + 0.5;
      const rel  = t + (opts.duration || 2.4);
      const tail = rel + 0.06;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.45, atk);
      env.gain.setValueAtTime(0.45, peak);
      env.gain.exponentialRampToValueAtTime(0.0001, rel);
      env.gain.linearRampToValueAtTime(0, tail);

      [o1, o2, lfo].forEach(function (o) { o.start(t); o.stop(tail + 0.01); });
    }).catch(function () {});
  }

  /**
   * UI tick — crisp, very short noise transient.
   * Great for: button clicks, nav tab switches, any minor UI feedback.
   */
  function playTick(opts) {
    opts = opts || {};
    ready().then(function () {
      const t = now();

      const env = makeGain(0);
      env.connect(master);

      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer();

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = opts.freq || 2400;

      src.connect(hp);
      hp.connect(env);

      const atk  = t + 0.001;
      const rel  = t + 0.055;
      const tail = rel + 0.008;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.52, atk);
      env.gain.exponentialRampToValueAtTime(0.0001, rel);
      env.gain.linearRampToValueAtTime(0, tail);

      src.start(t);
      src.stop(tail + 0.005);
    }).catch(function () {});
  }

  /**
   * Soft error buzz — low, short sawtooth pulse.
   * Great for: failed actions, insufficient funds, negative results.
   */
  function playBuzz(opts) {
    opts = opts || {};
    ready().then(function () {
      const t = now();

      const env = makeGain(0);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 320;
      env.connect(lp);
      lp.connect(master);

      const o = makeOsc('sawtooth', opts.freq || 120);
      o.connect(env);

      const rel  = t + 0.18;
      const tail = rel + 0.015;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.32, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, rel);
      env.gain.linearRampToValueAtTime(0, tail);

      o.start(t);
      o.stop(tail + 0.005);
    }).catch(function () {});
  }

  /* ── Public API ── */

  function setVolume(v) {
    _vol = Math.max(0, Math.min(1, v));
    if (master) master.gain.setTargetAtTime(_vol, ctx.currentTime, 0.02);
  }

  window.AudioFX = {
    playBell:  playBell,
    playGhost: playGhost,
    playTick:  playTick,
    playBuzz:  playBuzz,
    setVolume: setVolume,
    get ctx() { return ctx; }
  };

})();
