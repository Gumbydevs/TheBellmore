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

  /* ────────────────────────────────────────────────────────────
   * MUSIC ENGINE
   * Calm, looping procedural track — pentatonic melody over a
   * gentle arpeggiated chord bed and soft bass pulse.
   * Inspired by the unhurried warmth of Oregon Trail / iOS games.
   * ──────────────────────────────────────────────────────────── */

  let _musicPlaying = false;
  let _musicScheduled = 0;   // ctx.currentTime up to which notes are scheduled
  let _musicTimer   = null;
  let _musicBus     = null;  // gain bus for music (separate from SFX master)

  // D pentatonic major: D3 D4 E4 F#4 A4 B4 D5 E5 F#5 A5
  const _PENTA = [147, 294, 330, 370, 440, 494, 587, 659, 740, 880];

  // Chord roots (D major diatonic, looping every 4 bars): D  A  Bm  G
  const _CHORDS = [
    [294, 370, 440],   // D  maj  — D4 F#4 A4
    [440, 554, 659],   // A  maj  — A4 C#5 E5  (C#≈554)
    [247, 294, 370],   // Bm      — B3 D4  F#4
    [392, 494, 587]    // G  maj  — G4 B4  D5
  ];

  const _BAR   = 1.92;   // seconds per bar  (≈ 78 BPM, unhurried)
  const _BEAT  = _BAR / 4;
  const _AHEAD = _BAR * 2; // schedule this far ahead

  function _musicBusEnsure() {
    if (_musicBus) return;
    getCtx();
    _musicBus = ctx.createGain();
    _musicBus.gain.value = 0.18; // music sits quietly under SFX
    _musicBus.connect(ctx.destination); // bypass master so SFX vol changes don't affect music
  }

  // Smooth sine note — no clicks
  function _note(freq, startT, dur, peakGain, busNode) {
    const env = ctx.createGain();
    env.gain.value = 0;
    env.connect(busNode);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(env);

    const atk  = startT + 0.008;
    const rel  = startT + dur * 0.85;
    const end  = startT + dur + 0.04;

    env.gain.setValueAtTime(0, startT);
    env.gain.linearRampToValueAtTime(peakGain, atk);
    env.gain.setValueAtTime(peakGain, rel);
    env.gain.linearRampToValueAtTime(0, end);

    osc.start(startT);
    osc.stop(end + 0.01);
  }

  // Triangle note — slightly richer, used for melody
  function _melNote(freq, startT, dur, peakGain, busNode) {
    const env = ctx.createGain();
    env.gain.value = 0;

    // gentle lowpass keeps melody warm not piercing
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    env.connect(lp);
    lp.connect(busNode);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.connect(env);

    const atk = startT + 0.012;
    const rel = startT + dur * 0.78;
    const end = startT + dur + 0.06;

    env.gain.setValueAtTime(0, startT);
    env.gain.linearRampToValueAtTime(peakGain, atk);
    env.gain.setValueAtTime(peakGain, rel);
    env.gain.linearRampToValueAtTime(0, end);

    osc.start(startT);
    osc.stop(end + 0.01);
  }

  // Soft bass thump — short sine with fast decay
  function _bassNote(freq, startT, busNode) {
    const env = ctx.createGain();
    env.gain.value = 0;
    env.connect(busNode);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq / 2; // one octave down
    osc.connect(env);

    const end = startT + 0.45;
    env.gain.setValueAtTime(0, startT);
    env.gain.linearRampToValueAtTime(0.55, startT + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, end);
    env.gain.linearRampToValueAtTime(0, end + 0.02);

    osc.start(startT);
    osc.stop(end + 0.03);
  }

  // 8-note melodic phrase (two bars), loosely stepwise over pentatonic
  // Different phrase each repeat so it never sounds like a hard loop
  function _phrase(barStart, phraseIdx, busNode) {
    // Four melodic shapes, rotate through them
    const shapes = [
      [4,5,6,7, 6,5,4,3],
      [3,4,6,7, 9,7,6,4],
      [5,6,7,6, 4,3,4,5],
      [7,6,5,4, 5,6,7,9]
    ];
    const shape = shapes[phraseIdx % shapes.length];
    for (let i = 0; i < 8; i++) {
      const freq = _PENTA[shape[i] % _PENTA.length];
      const t    = barStart + i * (_BEAT / 2);
      // occasional rest (silence) on beat 4 & 8 for breathing room
      if (i === 3 || i === 7) continue;
      _melNote(freq, t, _BEAT * 0.48, 0.55, busNode);
    }
  }

  // Arpeggiated chord: three notes rolled quickly upward
  function _arp(chord, barStart, beat, busNode) {
    chord.forEach(function(freq, i) {
      _note(freq, barStart + beat * _BEAT + i * 0.055, _BEAT * 1.6, 0.28, busNode);
    });
  }

  let _phraseCount = 0;

  // Schedule 2 bars of material starting at `fromT`
  function _scheduleBars(fromT) {
    if (!_musicPlaying) return;
    _musicBusEnsure();
    const bus = _musicBus;
    const ci  = (_phraseCount >> 1) % _CHORDS.length; // new chord every 2 bars
    const chord = _CHORDS[ci];

    // Bar 1
    _bassNote(chord[0], fromT, bus);
    _arp(chord, fromT, 0, bus);
    _arp(chord, fromT, 2, bus);

    // Bar 2
    _bassNote(chord[0], fromT + _BAR, bus);
    _arp(chord, fromT + _BAR, 1, bus);
    _arp(chord, fromT + _BAR, 3, bus);

    // Melody across both bars
    _phrase(fromT, _phraseCount, bus);

    _phraseCount++;
    _musicScheduled = fromT + _BAR * 2;
  }

  function _musicTick() {
    if (!_musicPlaying) return;
    getCtx();
    const ahead = ctx.currentTime + _AHEAD;
    while (_musicScheduled < ahead) {
      _scheduleBars(_musicScheduled);
    }
    _musicTimer = setTimeout(_musicTick, (_BAR * 1000) / 2);
  }

  function musicStart() {
    if (_musicPlaying) return;
    ready().then(function () {
      _musicBusEnsure();
      _musicPlaying = true;
      _musicScheduled = ctx.currentTime + 0.1;
      _phraseCount = 0;
      _musicTick();
    }).catch(function () {});
  }

  function musicStop() {
    _musicPlaying = false;
    if (_musicTimer) { clearTimeout(_musicTimer); _musicTimer = null; }
    // Fade out music bus gracefully
    if (_musicBus && ctx) {
      _musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      setTimeout(function () {
        if (_musicBus) { _musicBus.gain.value = 0.18; }
      }, 2500);
    }
  }

  function musicFade(toVol, timeConstant) {
    if (_musicBus && ctx) {
      _musicBus.gain.setTargetAtTime(toVol, ctx.currentTime, timeConstant || 0.5);
    }
  }

  /* ── Public API ── */

  function setVolume(v) {
    _vol = Math.max(0, Math.min(1, v));
    if (master) master.gain.setTargetAtTime(_vol, ctx.currentTime, 0.02);
  }

  window.AudioFX = {
    playBell:   playBell,
    playGhost:  playGhost,
    playTick:   playTick,
    playBuzz:   playBuzz,
    setVolume:  setVolume,
    musicStart: musicStart,
    musicStop:  musicStop,
    musicFade:  musicFade,
    get ctx() { return ctx; }
  };

})();
