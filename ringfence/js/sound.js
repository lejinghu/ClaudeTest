/*
 * RINGFENCE sound: chiptune effects and a small music loop, synthesised with
 * WebAudio. There are no audio files, so the page stays one self-contained
 * file. Browsers only allow audio after a user gesture, so the context is
 * created on the first click.
 */
(function (root) {
  'use strict';
  let ctx = null;
  let master = null;
  let musicGain = null;
  let muted = false;
  let musicOn = true;
  let musicTimer = null;

  function ensure() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.18;
    musicGain.connect(master);
    return ctx;
  }

  // One square/triangle/saw blip with an optional pitch slide.
  function tone(freq, dur, opts) {
    const c = ensure();
    if (!c || muted) return;
    opts = opts || {};
    const t0 = c.currentTime + (opts.delay || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = opts.type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, opts.slide), t0 + dur);
    const vol = opts.vol == null ? 0.25 : opts.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(opts.bus || master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // A burst of noise (explosions, glitches, alarms).
  function noise(dur, opts) {
    const c = ensure();
    if (!c || muted) return;
    opts = opts || {};
    const t0 = c.currentTime + (opts.delay || 0);
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = opts.filter || 'lowpass';
    filt.frequency.value = opts.freq || 1800;
    const g = c.createGain();
    g.gain.value = opts.vol == null ? 0.3 : opts.vol;
    src.connect(filt);
    filt.connect(g);
    g.connect(master);
    src.start(t0);
  }

  const seq = (notes, step, opts) => notes.forEach((f, n) => f && tone(f, step * 0.9, Object.assign({}, opts, { delay: n * step })));

  const SFX = {
    click: () => tone(880, 0.05, { vol: 0.12 }),
    select: () => tone(660, 0.06, { vol: 0.15, type: 'triangle' }),
    error: () => { tone(160, 0.12, { vol: 0.2 }); tone(120, 0.15, { vol: 0.2, delay: 0.1 }); },
    observe: () => seq([523, 659, 784, 1047], 0.05, { vol: 0.12, type: 'triangle' }),
    harden: () => { seq([392, 523, 784], 0.07, { vol: 0.18 }); tone(1568, 0.25, { vol: 0.08, type: 'triangle', delay: 0.21 }); },
    ringfence: () => { tone(220, 0.08, { vol: 0.2 }); seq([330, 440, 554, 659], 0.06, { vol: 0.14, delay: 0.06 }); },
    wall: () => { noise(0.08, { vol: 0.25, freq: 900 }); tone(110, 0.1, { vol: 0.2 }); },
    deploy: () => seq([988, 1319], 0.05, { vol: 0.12, type: 'triangle' }),
    breach: () => { noise(0.18, { vol: 0.25, filter: 'highpass', freq: 2500 }); tone(200, 0.2, { vol: 0.18, type: 'sawtooth', slide: 800 }); },
    spread: () => tone(300, 0.08, { vol: 0.14, type: 'sawtooth', slide: 450 }),
    recon: () => seq([1200, 0, 1200], 0.05, { vol: 0.08 }),
    sensor: () => { noise(0.35, { vol: 0.35, freq: 1200 }); seq([880, 660, 880, 660], 0.07, { vol: 0.2 }); },
    jewel: () => seq([659, 784, 988, 1319], 0.06, { vol: 0.18, type: 'triangle' }),
    exfil: () => { tone(880, 0.6, { vol: 0.22, type: 'sawtooth', slide: 110 }); noise(0.5, { vol: 0.2, delay: 0.1 }); },
    outage: () => { tone(90, 0.35, { vol: 0.25, type: 'sawtooth' }); tone(95, 0.35, { vol: 0.2, type: 'square', delay: 0.02 }); },
    quarantine: () => seq([784, 659, 523, 392], 0.06, { vol: 0.16 }),
    income: () => seq([1047, 1319], 0.05, { vol: 0.08, type: 'triangle' }),
    turn: () => tone(523, 0.06, { vol: 0.1, type: 'triangle' }),
    win: () => { seq([523, 659, 784, 1047, 0, 784, 1047], 0.12, { vol: 0.2 }); seq([262, 330, 392, 523], 0.24, { vol: 0.12, type: 'triangle' }); },
    lose: () => { seq([392, 370, 349, 330, 0, 262], 0.16, { vol: 0.2 }); tone(65, 0.9, { vol: 0.2, type: 'triangle', delay: 0.6 }); },
  };

  // Music: a two-bar minor arpeggio and bass, looped, quiet.
  const BASS = [110, 0, 110, 0, 131, 0, 98, 0];
  const ARP = [440, 523, 659, 523, 494, 587, 659, 587, 392, 494, 587, 494, 440, 523, 659, 784];
  function startMusic() {
    const c = ensure();
    if (!c || musicTimer) return;
    let step = 0;
    const beat = 0.16;
    musicTimer = setInterval(() => {
      if (muted || !musicOn) return;
      const a = ARP[step % ARP.length];
      if (a) tone(a, beat * 0.8, { vol: 0.12, type: 'square', bus: musicGain });
      if (step % 2 === 0) {
        const b = BASS[(step / 2) % BASS.length];
        if (b) tone(b, beat * 1.8, { vol: 0.35, type: 'triangle', bus: musicGain });
      }
      step++;
    }, beat * 1000);
  }
  function stopMusic() {
    clearInterval(musicTimer);
    musicTimer = null;
  }

  root.RFSOUND = {
    play(name) {
      try { if (SFX[name]) SFX[name](); } catch (e) { /* audio unavailable */ }
    },
    unlock() {
      const c = ensure();
      if (c && c.state === 'suspended') c.resume();
      if (musicOn) startMusic();
    },
    setMuted(m) {
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : 0.5;
    },
    setMusic(on) {
      musicOn = !!on;
      if (musicOn && ctx) startMusic();
      if (!musicOn) stopMusic();
    },
    get muted() { return muted; },
    get music() { return musicOn; },
  };
})(typeof self !== 'undefined' ? self : this);
