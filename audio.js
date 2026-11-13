export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicSource = null;
    this.currentMusicGain = null;

    // Engine specific
    this.engineBuffer = null;
    this.engineSource = null;
    this.engineGain = null;
    this.enginePitch = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.ctx.destination);

    // Preload engine sound
    fetch('/engine-music.mp3')
      .then(r => r.arrayBuffer())
      .then(b => this.ctx.decodeAudioData(b))
      .then(buf => { this.engineBuffer = buf; })
      .catch(() => console.warn("engine-music.mp3 not found in public folder"));
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.8;
    return this.muted;
  }

  // --- MENU MUSIC ---
  async playMenuMusic() {
    if (!this.ctx || this.musicSource) return;
    try {
      const response = await fetch('/menu-music.mp3');
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

      this.musicSource = this.ctx.createBufferSource();
      this.musicSource.buffer = audioBuffer;
      this.musicSource.loop = true;

      this.currentMusicGain = this.ctx.createGain();
      this.currentMusicGain.gain.value = 0.4;

      this.musicSource.connect(this.currentMusicGain);
      this.currentMusicGain.connect(this.master);
      this.musicSource.start();
    } catch (err) { console.warn("Could not load /menu-music.mp3"); }
  }

  stopMenuMusic() {
    if (this.musicSource) {
      this.musicSource.stop();
      this.musicSource.disconnect();
      this.musicSource = null;
    }
    if (this.currentMusicGain) {
      this.currentMusicGain.disconnect();
      this.currentMusicGain = null;
    }
  }

  // --- ENGINE MUSIC ---
  startEngine() {
    if (!this.ctx || !this.engineBuffer || this.engineSource) return;

    this.engineSource = this.ctx.createBufferSource();
    this.engineSource.buffer = this.engineBuffer;
    this.engineSource.loop = true;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0; // Start silent

    this.enginePitch = this.ctx.createBiquadFilter();
    this.enginePitch.type = 'lowpass';
    this.enginePitch.frequency.value = 400;

    this.engineSource.connect(this.enginePitch);
    this.enginePitch.connect(this.engineGain);
    this.engineGain.connect(this.master);

    this.engineSource.start();
  }

  stopEngine() {
    if (this.engineSource) {
      this.engineSource.stop();
      this.engineSource.disconnect();
      this.engineSource = null;
    }
    if (this.engineGain) {
      this.engineGain.disconnect();
      this.engineGain = null;
    }
  }

  setEngine(active, ratio, boosting) {
    if (!this.ctx || !this.engineSource) return;
    const r = Math.max(0, Math.min(1.5, ratio));

    // Adjust pitch based on speed
    let targetRate = 0.8 + (r * 0.8) + (boosting ? 0.4 : 0);
    this.engineSource.playbackRate.setTargetAtTime(targetRate, this.ctx.currentTime, 0.1);

    // Open the filter as you go faster
    let targetFreq = 300 + (r * 1200) + (boosting ? 800 : 0);
    this.enginePitch.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.1);

    // Volume
    this.engineGain.gain.setTargetAtTime(active ? 0.4 + (r * 0.2) : 0, this.ctx.currentTime, 0.2);
  }

  // --- SFX ---
  beep(freq = 440, dur = 0.15, type = 'sine', vol = 0.25, slideTo = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  count() { this.beep(440, 0.18, 'square', 0.18); }
  go() { this.beep(880, 0.5, 'square', 0.22); }
  pad() { this.beep(300, 0.35, 'sawtooth', 0.18, 1200); }
  lap() { this.beep(660, 0.12, 'triangle', 0.25); setTimeout(() => this.beep(990, 0.2, 'triangle', 0.25), 110); }
  record() { [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => this.beep(f, 0.18, 'triangle', 0.25), i * 90)); }
  finish() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.beep(f, 0.3, 'square', 0.2), i * 140)); }
}