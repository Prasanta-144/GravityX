import { MAX_LATERAL } from './tracks.js';

export const PHYS = {
  BASE_TOP: 100, ACCEL: 45, BRAKE: 90, COAST_DECAY: 1.2, BOOST_MULT: 1.35, BOOST_ACCEL_MULT: 2,
  BOOST_DRAIN: 30, BOOST_REGEN: 6, DRIFT_CHARGE: 14, DRIFT_SPEED_LOSS: 0.06, STEER_ACC: 30, GRIP: 9,
  DRIFT_GRIP: 1.8, CENT: 0.22, WALL_DRAG: 1.5, PAD_TIME: 1.2, PAD_SPEED: 1.15,
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const wrap01 = (d) => (((d % 1) + 1.5) % 1) - 0.5;

export class Racer {
  constructor(e) {
    this.id = e.id;
    this.name = e.name;
    this.vehicle = e.vehicle;
    this.stats = { speed: 1, accel: 1, handling: 1, boost: 1, ...(e.vehicle.stats || {}) };
    this.color = e.color;
    this.isPlayer = !!e.isPlayer;
    this.baseSpeedFactor = e.speedFactor ?? 1;
    this.speedFactor = this.baseSpeedFactor;
    this.skill = e.skill ?? 0.7;
    this.totalLaps = 1;
    this.frame = null;
    this.reset(0, 0);
  }

  reset(progress, lateral) {
    this.progress = this.prevProgress = progress;
    this.lateral = this.prevLateral = lateral;
    this.latVel = 0;
    this.speed = 0;
    this.boostMeter = 50;
    this.boosting = false;
    this.padTimer = 0;
    this.padCooldown = 0;
    this.lapsDone = 0;
    this.lapStart = 0;
    this.lapTimes = [];
    this.bestLap = Infinity;
    this.finished = false;
    this.finishTime = null;
    this.position = 1;
    this.wallHit = 0;
    this.drifting = false;

    // Combat additions
    this.health = 100;
    this.fireCooldown = 0;
    this.isDead = false;
  }

  get topSpeed() { return PHYS.BASE_TOP * this.stats.speed; }

  step(dt, input, track, time) {
    const P = PHYS, st = this.stats;
    const events = [];
    if (!this.frame) this.frame = track.makeFrame();
    const fr = track.frameAt(this.progress, this.frame);

    // Cooldowns
    if (this.fireCooldown > 0) this.fireCooldown -= dt;

    // Shooting
    if (input.fire && this.fireCooldown <= 0 && !this.isDead) {
      this.fireCooldown = 0.3; // 3 shots per second
      events.push({ type: 'shoot', racer: this });
    }

    // Health regen (slowly over time)
    if (!this.isDead) {
      this.health = Math.min(100, this.health + 2 * dt);
      if (this.health <= 0) {
        this.isDead = true;
        this.speed = 0; // Stop if dead
        events.push({ type: 'dead', racer: this });
      }
    }

    const top = this.topSpeed * this.speedFactor;
    const wantBoost = !!input.boost && this.boostMeter > 0 && this.speed > 5;
    if (this.padTimer > 0) this.padTimer -= dt;
    this.boosting = wantBoost || this.padTimer > 0;
    const maxNow = top * (this.boosting ? P.BOOST_MULT : 1);
    const acc = P.ACCEL * st.accel * (this.boosting ? P.BOOST_ACCEL_MULT : 1);

    if (!this.isDead) {
      if (input.throttle > 0) {
        if (this.speed < maxNow) this.speed = Math.min(maxNow, this.speed + acc * input.throttle * dt);
      }
      else if (input.throttle < 0) this.speed += P.BRAKE * input.throttle * dt;
      else this.speed *= Math.exp(-P.COAST_DECAY * dt);
      if (this.speed > maxNow) this.speed -= (this.speed - maxNow) * Math.min(1, 2.5 * dt);
      this.speed = Math.max(-top * 0.3, this.speed);
    } else {
      this.speed *= Math.exp(-P.COAST_DECAY * 3 * dt); // Quick stop if dead
    }

    if (wantBoost) this.boostMeter = Math.max(0, this.boostMeter - P.BOOST_DRAIN * dt);
    else this.boostMeter = Math.min(100, this.boostMeter + P.BOOST_REGEN * st.boost * dt);

    // lateral dynamics
    const sp = Math.max(0, this.speed);
    const authority = st.handling * Math.min(1, 0.35 + (sp / (top * 0.5)) * 0.65);
    const bankRelief = 1 - 0.5 * Math.min(1, Math.abs(fr.bank) / 0.5);
    const cent = P.CENT * fr.kappa * sp * sp * bankRelief;
    this.drifting = !!input.drift;
    const grip = this.drifting ? P.DRIFT_GRIP : P.GRIP;
    this.latVel += (input.steer * P.STEER_ACC * authority + cent) * dt;
    this.latVel *= Math.exp(-grip * dt);
    this.lateral += this.latVel * dt;

    if (this.drifting && Math.abs(this.latVel) > 4 && sp > top * 0.4) {
      this.boostMeter = Math.min(100, this.boostMeter + P.DRIFT_CHARGE * dt);
      this.speed *= 1 - P.DRIFT_SPEED_LOSS * dt;
    }

    if (this.wallHit > 0) this.wallHit -= dt;
    if (Math.abs(this.lateral) > MAX_LATERAL) {
      const s = Math.sign(this.lateral);
      this.lateral = s * MAX_LATERAL;
      if (this.latVel * s > 0) {
        const impact = Math.abs(this.latVel);
        this.speed = Math.max(0, this.speed - impact * P.WALL_DRAG);
        if (impact > 2) this.wallHit = 0.25;
        this.latVel *= -0.4;

        // Take damage from hitting walls
        if (impact > 4) {
          this.health -= impact * 1.5;
          events.push({ type: 'hit', racer: this, damage: impact * 1.5 });
        }
      }
    }

    const prev = this.progress;
    this.progress += (this.speed * dt) / track.length;

    if (this.padCooldown > 0) this.padCooldown -= dt;
    else {
      for (let i = 0; i < track.pads.length; i++) {
        const pad = track.pads[i];
        const d = wrap01(this.progress - pad.t) * track.length;
        if (Math.abs(d) < 3.5 && Math.abs(this.lateral - pad.lat) < 2.8) {
          this.boostMeter = 100;
          this.padTimer = P.PAD_TIME;
          this.speed = Math.max(this.speed, top * P.PAD_SPEED);
          this.padCooldown = 0.6;
          events.push({ type: 'pad', racer: this, index: i });
          break;
        }
      }
    }

    if (prev < 0 && this.progress >= 0) {
      const tc = time + (-prev / (this.progress - prev)) * dt;
      events.push({ type: 'start', racer: this, time: tc });
    }
    const fl = Math.floor(this.progress);
    if (fl > this.lapsDone) {
      const tc = time + ((fl - prev) / (this.progress - prev)) * dt;
      this.lapsDone = fl;
      const lapTime = tc - this.lapStart;
      this.lapStart = tc;
      this.lapTimes.push(lapTime);
      if (lapTime < this.bestLap) this.bestLap = lapTime;
      events.push({ type: 'lap', racer: this, lapNo: fl, lapTime, time: tc });
      if (fl >= this.totalLaps && !this.finished) {
        this.finished = true;
        this.finishTime = tc;
        events.push({ type: 'finish', racer: this, time: tc });
      }
    }
    return events;
  }
}

// AI DRIVER (Simplified for brevity, but kept intact)
export class AIDriver {
  constructor(skill, rng = Math.random) {
    this.skill = skill;
    this.rng = rng;
    this.lane = (rng() * 2 - 1) * 3.4;
    this.reaction = (0.05 + rng() * 0.35) * (1.2 - skill);
    this.curPad = -1;
    this.boostOn = false;
  }

  control(r, race, dt) {
    const track = race.track, L = track.length;
    if (race.time < this.reaction) return { throttle: 0, steer: 0, drift: false, boost: false, fire: false };

    const sp = Math.max(r.speed, 15);
    const kNow = track.kappaAt(r.progress);
    const kAhead = track.kappaAt(r.progress + Math.max(30, sp * 0.8) / L);
    const kAbs = Math.abs(kAhead);

    let target = this.lane * (1 - Math.min(1, kAbs * 350));
    target += -Math.sign(kAhead) * Math.min(1, kAbs * 250) * 3.2 * this.skill;

    if (this.curPad < 0) {
      for (let i = 0; i < track.pads.length; i++) {
        const d = (((track.pads[i].t - r.progress) % 1) + 1) % 1 * L;
        if (d > 25 && d < 150 && this.rng() < 0.02 + 0.06 * this.skill) { this.curPad = i; break; }
      }
    }
    if (this.curPad >= 0) {
      const pad = track.pads[this.curPad];
      const d = wrap01(pad.t - r.progress) * L;
      if (d < -6) this.curPad = -1;
      else target = pad.lat;
    }

    let block = null, blockDist = 28;
    for (const o of race.racers) {
      if (o === r) continue;
      const ds = wrap01(o.progress - r.progress) * L;
      if (ds > 0 && ds < blockDist && Math.abs(o.lateral - r.lateral) < 3.2) { block = o; blockDist = ds; }
    }
    if (block) {
      let dir = r.lateral - block.lateral >= 0 ? 1 : -1;
      if (Math.abs(block.lateral + dir * 3.6) > MAX_LATERAL - 0.4) dir = -dir;
      target = block.lateral + dir * 3.6;
    }
    target = clamp(target, -(MAX_LATERAL - 0.7), MAX_LATERAL - 0.7);

    const err = target - r.lateral;
    const wantV = clamp(err * 1.6, -3.4, 3.4);
    const steer = clamp((wantV - r.latVel) * 0.9, -1, 1);

    if (this.skill > 0.3) {
      if (!this.boostOn && r.boostMeter > 60 && kAbs < 0.002 && Math.abs(kNow) < 0.002) this.boostOn = true;
      if (this.boostOn && (r.boostMeter < 8 || kAbs > 0.0035)) this.boostOn = false;
    }

    // AI shoot randomly if close to a target
    let fire = false;
    if (this.rng() < 0.01) fire = true;

    return { throttle: 1, steer, drift: false, boost: this.boostOn, fire };
  }
}