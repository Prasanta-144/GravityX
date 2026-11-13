import { Racer, AIDriver, wrap01 } from './racer.js';

export const STEP = 1 / 120;
export const COUNTDOWN_TIME = 3;
export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
export const GHOST_DT = 0.05;

export const DIFFICULTY = {
  easy:   { label: 'Easy',   speed: 0.86, skill: 0.45, rubber: 0.06 },
  normal: { label: 'Normal', speed: 0.94, skill: 0.70, rubber: 0.04 },
  hard:   { label: 'Hard',   speed: 1.00, skill: 0.92, rubber: 0.03 },
};

export class Race {
  constructor({ track, laps, entries, mode = 'quick', difficulty = 'normal', ghost = null, rng = Math.random }) {
    this.track = track;
    this.laps = laps;
    this.mode = mode;
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.rng = rng;
    this.ghost = ghost;
    this.ghostStart = null;

    this.racers = entries.map(e => { const r = new Racer(e); r.totalLaps = laps; return r; });
    this.player = this.racers.find(r => r.isPlayer) || null;
    this.drivers = new Map();
    for (const r of this.racers) this.drivers.set(r.id, new AIDriver(r.isPlayer ? 0.8 : r.skill, rng));

    this.racers.forEach((r, i) => { r.gridIndex = entries[i].gridIndex ?? i; });
    this.racers.slice().sort((a, b) => a.gridIndex - b.gridIndex).forEach((r, i) => {
      const row = Math.floor(i / 2), col = i % 2;
      r.reset(-(8 + row * 8 + col * 3.5) / track.length, col ? 2.6 : -2.6);
    });

    this.phase = 'countdown';
    this.countdown = COUNTDOWN_TIME;
    this.lastCountN = null;
    this.time = 0;
    this.acc = 0;
    this.alpha = 0;
    this.events = [];
    this.order = this.racers.slice();
    this.results = null;
    this.completedAt = null;

    this.rec = [];
    this.recStart = null;
    this.updateOrder();
  }

  drainEvents() { const e = this.events; this.events = []; return e; }

  update(dt, playerInput) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      for (const r of this.racers) { r.prevProgress = r.progress; r.prevLateral = r.lateral; }
      this.tick(STEP, playerInput || { throttle: 0, steer: 0, drift: false, boost: false });
    }
    this.alpha = this.acc / STEP;
  }

  tick(dt, input) {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const n = Math.max(0, Math.ceil(this.countdown));
      if (n !== this.lastCountN && this.countdown > 0) { this.lastCountN = n; this.events.push({ type: 'count', n }); }
      if (this.countdown <= 0) { this.phase = 'racing'; this.time = 0; this.events.push({ type: 'go' }); }
      return;
    }
    if (this.phase !== 'racing') return;

    const t0 = this.time;
    for (const r of this.racers) {
      let inp;
      if (r.isPlayer && !r.finished) inp = input;
      else inp = this.drivers.get(r.id).control(r, this, dt);

      if (!r.isPlayer && this.player && !this.player.finished) {
        const delta = (this.player.progress - r.progress) * this.track.length;
        const f = delta > 0 ? Math.min(1, delta / 500) * this.diff.rubber
                            : Math.max(-1, delta / 500) * this.diff.rubber * 0.5;
        r.speedFactor = r.baseSpeedFactor * (1 + f);
      }

      for (const ev of r.step(dt, inp, this.track, t0)) this.handleEvent(ev);
    }
    this.time += dt;

    const p = this.player;
    if (p && this.recStart !== null && !p.finished) {
      while (this.time - this.recStart >= this.rec.length * GHOST_DT) {
        this.rec.push([+(p.progress - p.lapsDone).toFixed(5), +p.lateral.toFixed(2)]);
      }
    }

    this.collide();
    this.updateOrder();
    this.checkComplete();
  }

  handleEvent(ev) {
    if (ev.racer === this.player) {
      if (ev.type === 'start') {
        this.recStart = ev.time; this.rec = []; this.ghostStart = ev.time;
      } else if (ev.type === 'lap') {
        ev.rec = this.rec;
        this.recStart = ev.time; this.rec = []; this.ghostStart = ev.time;
      }
    }
    this.events.push(ev);
  }

  collide() {
    const L = this.track.length, rs = this.racers;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        const ds = wrap01(b.progress - a.progress) * L;
        if (Math.abs(ds) > 4) continue;
        const dl = b.lateral - a.lateral;
        if (Math.abs(dl) > 2.3) continue;
        const dir = dl === 0 ? (i % 2 ? 1 : -1) : Math.sign(dl);
        const push = (2.3 - Math.abs(dl)) * 0.5;
        a.lateral -= dir * push; b.lateral += dir * push;
        a.latVel -= dir * 2.5;   b.latVel += dir * 2.5;
        const [rear, front] = ds > 0 ? [a, b] : [b, a];
        if (rear.speed > front.speed) rear.speed -= (rear.speed - front.speed) * 0.5;
      }
    }
  }

  updateOrder() {
    this.order = this.racers.slice().sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishTime - b.finishTime;
      return b.progress - a.progress;
    });
    this.order.forEach((r, i) => { r.position = i + 1; });
  }

  checkComplete() {
    if (this.results) return;
    const p = this.player;
    const allDone = this.racers.every(r => r.finished);
    const playerDone = !p || p.finished;
    const timeout = this.time > 900 || (p && p.finished && this.time - p.finishTime > 12);
    if ((allDone && playerDone) || timeout) {
      this.results = this.order.map((r, i) => ({
        racer: r, position: i + 1,
        time: r.finished ? r.finishTime : null,
        bestLap: r.bestLap === Infinity ? null : r.bestLap,
        dnf: !r.finished,
      }));
      this.phase = 'finished';
      this.completedAt = this.time;
      this.events.push({ type: 'complete' });
    }
  }

  ghostPose() {
    if (!this.ghost || this.ghostStart === null || this.phase !== 'racing') return null;
    const s = this.ghost.samples, t = (this.time - this.ghostStart) / (this.ghost.step || GHOST_DT);
    if (t < 0 || t >= s.length - 1) return null;
    const i = Math.floor(t), u = t - i;
    return { progress: s[i][0] + (s[i + 1][0] - s[i][0]) * u, lateral: s[i][1] + (s[i + 1][1] - s[i][1]) * u };
  }
}