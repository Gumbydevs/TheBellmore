class AudioFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.45; // safe default
    this._noiseBuffer = null;
  }

  _init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  resumeOnUserGesture(root = document) {
    this._init();
    const resume = () => {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(()=>{});
      }
      root.removeEventListener('pointerdown', resume);
      root.removeEventListener('keydown', resume);
    };
    root.addEventListener('pointerdown', resume, { once: true });
    root.addEventListener('keydown', resume, { once: true });
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this._now(), 0.01);
  }

  _now() { return (this.ctx && this.ctx.currentTime) ? this.ctx.currentTime : 0; }

  _makeOsc(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  _makeGain() { return this.ctx.createGain(); }

  _noiseBufferCreate() {
    if (this._noiseBuffer) return this._noiseBuffer;
    const sr = this.ctx.sampleRate;
    const len = sr * 1.0; // 1s buffer
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
    this._noiseBuffer = buf;
    return buf;
  }

  // Gentle desk bell: multiple detuned partials, quick attack, warm decay
  playBell(opts = {}) {
    this._init();
    const now = this._now();
    const freq = opts.freq || 880; // A5-ish
    const gain = this._makeGain();
    gain.gain.value = 0.0001;
    gain.connect(this.master);

    const osc1 = this._makeOsc('sine', freq);
    const osc2 = this._makeOsc('triangle', freq * 1.997);
    const osc3 = this._makeOsc('sine', freq * 0.501);

    osc1.connect(gain);
    osc2.connect(gain);
    osc3.connect(gain);

    const attack = 0.002;
    const decay = 1.4;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.9, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0002, now + decay);

    const stopTime = now + decay + 0.1;

    osc1.start(now);
    osc2.start(now);
    osc3.start(now);
    osc1.stop(stopTime);
    osc2.stop(stopTime);
    osc3.stop(stopTime);
  }

  // Soft ghost: low pad with pitch glide and filtered noise
  playGhost(opts = {}) {
    this._init();
    const now = this._now();
    const base = opts.freq || 160;
    const gain = this._makeGain();
    gain.gain.value = 0.0001;
    gain.connect(this.master);

    const osc = this._makeOsc('sine', base * 1.0);
    const osc2 = this._makeOsc('sine', base * 1.001);
    osc.connect(gain);
    osc2.connect(gain);

    // bandpass to give breathy character
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.7;
    gain.disconnect(this.master);
    gain.connect(bp);
    bp.connect(this.master);

    // LFO for subtle pitch wobble
    const lfo = this._makeOsc('sine', 0.6);
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 6; // small modulation
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfoGain.connect(osc2.frequency);

    const attack = 0.12;
    const release = 1.8;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.35, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0003, now + attack + release);

    osc.start(now);
    osc2.start(now);
    lfo.start(now);

    osc.stop(now + attack + release + 0.1);
    osc2.stop(now + attack + release + 0.1);
    lfo.stop(now + attack + release + 0.1);
  }

  // Small UI tick/click: short percussive transient
  playTick(opts = {}) {
    this._init();
    const now = this._now();
    const gain = this._makeGain();
    gain.gain.value = 0.0001;
    gain.connect(this.master);

    // small noise burst
    const buf = this._noiseBufferCreate();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1200;
    src.connect(filter);
    filter.connect(gain);

    const attack = 0.001;
    const decay = 0.06;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.9, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);

    src.start(now);
    src.stop(now + attack + decay + 0.02);
  }
}

// expose a single instance
window.AudioFX = new AudioFX();

// Small helper for convenience (safe defaults)
window.AudioFXPreview = function(){
  try { window.AudioFX.playTick(); setTimeout(()=>window.AudioFX.playBell(), 120); } catch(e){}
};
