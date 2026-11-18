// Solmara — audio.js
// WebAudio synthesis only: no audio assets, no network. Every sound is a
// handful of oscillators / one shared noise buffer, created lazily on the
// first user gesture (init). Engine hum and siren are persistent nodes
// whose pitch/gain are steered per frame — nothing is allocated per frame.
const Sol = window.Sol = window.Sol || {};

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let engineFilter = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenOn = false;
  let sirenPhase = 0;
  let sirenTimer = 0;
  let engineOn = false;
  let engineSpeed = 0;
  let muted = false;
  let ready = false;

  function ensureNoise() {
    if (noiseBuf || !ctx) return;
    const len = ctx.sampleRate * 0.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  // Short enveloped tone. slideTo (Hz) bends the pitch over the note.
  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, filterFreq, delay) {
    if (!ctx || muted) return;
    ensureNoise();
    const t0 = ctx.currentTime + (delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = src;
    if (filterFreq) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      src.connect(filter);
      node = filter;
    }
    node.connect(gain);
    gain.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const audio = {
    get muted() {
      return muted;
    },
    get ready() {
      return ready;
    },

    // Call on the first user gesture. Safe to call repeatedly; the
    // AudioContext is created once and resumed if suspended.
    init() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(ctx.destination);
        ensureNoise();

        // Engine hum: two detuned sawtooths through a lowpass, gain 0.
        engineFilter = ctx.createBiquadFilter();
        engineFilter.type = 'lowpass';
        engineFilter.frequency.value = 420;
        engineGain = ctx.createGain();
        engineGain.gain.value = 0;
        engineOsc = ctx.createOscillator();
        engineOsc.type = 'sawtooth';
        engineOsc.frequency.value = 55;
        engineOsc2 = ctx.createOscillator();
        engineOsc2.type = 'sawtooth';
        engineOsc2.frequency.value = 83;
        engineOsc.connect(engineFilter);
        engineOsc2.connect(engineFilter);
        engineFilter.connect(engineGain);
        engineGain.connect(master);
        engineOsc.start();
        engineOsc2.start();

        // Siren: one triangle oscillator, frequency flipped by update().
        sirenOsc = ctx.createOscillator();
        sirenOsc.type = 'triangle';
        sirenOsc.frequency.value = 720;
        sirenGain = ctx.createGain();
        sirenGain.gain.value = 0;
        sirenOsc.connect(sirenGain);
        sirenGain.connect(master);
        sirenOsc.start();
        ready = true;
      }
      if (ctx.state === 'suspended') ctx.resume();
    },

    setMuted(b) {
      muted = !!b;
      if (master && ctx) {
        master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
      }
    },

    toggleMute() {
      this.setMuted(!muted);
      return muted;
    },

    // Engine hum on/off; speed01 in [0, 1] steers pitch + loudness.
    setEngine(on, speed01) {
      engineOn = !!on;
      engineSpeed = Math.max(0, Math.min(1, speed01 || 0));
    },

    // Siren loop while the police are chasing.
    setSiren(on) {
      sirenOn = !!on;
    },

    sfx(name) {
      if (!ctx || muted) return;
      switch (name) {
        case 'shot':
          noise(0.14, 0.5, 1800);
          tone(220, 0.1, 'square', 0.22, 55);
          break;
        case 'punch':
          noise(0.09, 0.35, 900);
          tone(140, 0.09, 'sine', 0.3, 70);
          break;
        case 'cash':
          tone(880, 0.09, 'sine', 0.25);
          tone(1318, 0.14, 'sine', 0.25, null, 0.08);
          break;
        case 'pickup':
          tone(660, 0.08, 'sine', 0.22);
          tone(990, 0.12, 'sine', 0.22, null, 0.07);
          break;
        case 'ui':
          tone(520, 0.06, 'sine', 0.18);
          break;
        case 'busted':
          tone(392, 0.22, 'sawtooth', 0.2, 370);
          tone(311, 0.3, 'sawtooth', 0.2, 294, 0.2);
          break;
        case 'wasted':
          tone(220, 0.4, 'sawtooth', 0.22, 110);
          tone(165, 0.6, 'sawtooth', 0.22, 82, 0.35);
          break;
        case 'siren':
          // One-shot wail for a newly spotted crime (the loop is setSiren).
          tone(720, 0.35, 'triangle', 0.16, 960);
          tone(960, 0.35, 'triangle', 0.16, 720, 0.35);
          break;
        case 'horn':
          tone(370, 0.18, 'square', 0.14);
          tone(466, 0.18, 'square', 0.14);
          break;
        default:
          tone(440, 0.08, 'sine', 0.15);
          break;
      }
    },

    // Per-frame steering only: no nodes are created here.
    update(dt) {
      if (!ctx) return;
      const t = ctx.currentTime;
      if (engineOsc) {
        const targetGain = engineOn && !muted ? 0.05 + engineSpeed * 0.075 : 0;
        engineGain.gain.setTargetAtTime(targetGain, t, 0.08);
        const freq = 48 + engineSpeed * 72;
        engineOsc.frequency.setTargetAtTime(freq, t, 0.08);
        engineOsc2.frequency.setTargetAtTime(freq * 1.5, t, 0.08);
        engineFilter.frequency.setTargetAtTime(320 + engineSpeed * 700, t, 0.1);
      }
      if (sirenOsc) {
        const targetGain = sirenOn && !muted ? 0.055 : 0;
        sirenGain.gain.setTargetAtTime(targetGain, t, 0.1);
        if (sirenOn) {
          sirenTimer += dt;
          if (sirenTimer >= 0.42) {
            sirenTimer = 0;
            sirenPhase = 1 - sirenPhase;
            sirenOsc.frequency.setTargetAtTime(sirenPhase ? 960 : 660, t, 0.03);
          }
        }
      }
    },
  };

  return audio;
}

Sol.createAudio = createAudio;
