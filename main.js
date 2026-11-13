import * as THREE from 'three';
import { createSpace } from './space.js';
import { Track, TRACKS, TRACK_ORDER } from './tracks.js';
import { preloadVehicles, VehicleVisual, VEHICLES, getVehicle } from './vehicles.js';
import { Race, POINTS, DIFFICULTY } from './race.js';
import { Sound } from './audio.js';
import * as Records from './records.js';

// MOBILE: detect mobile once, used throughout
const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

// --- 1. SCENE SETUP ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);

// MOBILE: renderer tuned for phones
const renderer = new THREE.WebGLRenderer({
  antialias: !isMobile,
  powerPreference: 'high-performance',
  precision: isMobile ? 'mediump' : 'highp',
  alpha: false,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
document.body.appendChild(renderer.domElement);

// MOBILE: adaptive resolution scaler state
let frameAcc = 0, frameCount = 0;
let targetPR = renderer.getPixelRatio();
const MIN_PR = 0.75, MAX_PR = isMobile ? 1.5 : 2;

function adaptResolution(dt) {
  frameAcc += dt;
  frameCount++;
  if (frameAcc < 1.0) return;
  const avg = frameAcc / frameCount;
  frameAcc = 0; frameCount = 0;

  if (avg > 0.022 && targetPR > MIN_PR) {
    targetPR = Math.max(MIN_PR, targetPR - 0.1);
    renderer.setPixelRatio(targetPR);
  } else if (avg < 0.014 && targetPR < MAX_PR) {
    targetPR = Math.min(MAX_PR, targetPR + 0.05);
    renderer.setPixelRatio(targetPR);
  }
}

const space = createSpace(scene);
const sound = new Sound();

// Showroom
const showroomGroup = new THREE.Group();
showroomGroup.visible = false;
scene.add(showroomGroup);
let showroomVisual = null;
const ringGeo = new THREE.RingGeometry(1.5, 3.5, 32);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
const hologramRing = new THREE.Mesh(ringGeo, ringMat);
hologramRing.rotation.x = -Math.PI / 2;
hologramRing.position.y = -0.5;
showroomGroup.add(hologramRing);

// --- 2. DOM ELEMENTS ---
const $ = id => document.getElementById(id);
const ui = {
  loading: $('loading'), menu: $('menu'), hud: $('hud'), results: $('results'), pause: $('pause'), garage: $('garage-screen'), records: $('records-screen'),
  lapValue: $('lap-value'), timerValue: $('timer-value'), lastLap: $('last-lap'), bestLap: $('best-lap'), posValue: $('pos-value'),
  speedValue: $('speed-value'), boostBar: $('boost-bar'), healthBar: $('health-bar'), leaderboard: $('leaderboard'), toast: $('toast'), countdown: $('countdown'),
  minimap: $('minimap'),
};

// --- 3. MENU LOGIC ---
let settings = { mode: 'quick', trackId: 'training', laps: 1, opponents: 5, difficulty: 'normal', vehicleId: 'phantom' };
const menuSegs = document.querySelectorAll('.seg');
menuSegs.forEach(seg => {
  const key = seg.dataset.key;
  if (!key) return;
  seg.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      settings[key] = seg.dataset.num ? parseInt(btn.dataset.v) : btn.dataset.v;
      if (key === 'mode') updateMenuVisibility();
    });
  });
});

function updateMenuVisibility() {
  $('g-opp').style.display = settings.mode === 'tt' ? 'none' : 'block';
  $('g-diff').style.display = settings.mode === 'tt' ? 'none' : 'block';
}

const trackSeg = $('track-seg');
TRACK_ORDER.forEach(id => {
  const def = TRACKS[id];
  const b = document.createElement('button');
  b.dataset.v = id; b.innerText = def.name;
  if (id === settings.trackId) b.classList.add('active');
  b.addEventListener('click', () => {
    trackSeg.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
    b.classList.add('active');
    settings.trackId = id;
    updateTrackInfo();
  });
  trackSeg.appendChild(b);
});

function updateTrackInfo() {
  const def = TRACKS[settings.trackId];
  $('track-info').innerHTML = `<span class="stars">${'★'.repeat(def.difficulty)}${'☆'.repeat(3-def.difficulty)}</span> ${def.description}`;
}
updateTrackInfo();
updateMenuVisibility();

// --- VEHICLE GARAGE LOGIC ---
const VEHICLE_LORE = {
  phantom: "A prototype stolen from the Andromeda Shipyards. Its adaptive hull makes it the most balanced machine in the fleet.",
  comet: "Built for straight-line velocity. The Comet's twin plasma engines burn hotter than a star, but its thin armor makes turning a deadly gamble.",
  nova: "Designed for asteroid field skirmishes. The four-wing configuration provides unmatched agility, allowing pilots to thread the needle at breakneck speeds.",
  titan: "A repurposed mining freighter. Slow, heavy, and practically indestructible. Its massive cargo hold was converted into a high-capacity energy reservoir."
};
let garageIndex = 0;

function updateGarageUI() {
  const v = VEHICLES[garageIndex];
  $('garage-name').innerText = v.name;
  $('garage-lore').innerText = VEHICLE_LORE[v.id] || "No data available.";
  $('garage-stats').innerHTML = `
    <div class="statrow"><span>Speed</span><div class="bar"><i style="width:${(v.stats.speed-0.8)*200}%"></i></div></div>
    <div class="statrow"><span>Accel</span><div class="bar"><i style="width:${(v.stats.accel-0.8)*200}%"></i></div></div>
    <div class="statrow"><span>Handling</span><div class="bar"><i style="width:${(v.stats.handling-0.8)*200}%"></i></div></div>
    <div class="statrow"><span>Boost</span><div class="bar"><i style="width:${(v.stats.boost-0.8)*200}%"></i></div></div>
  `;
  if (showroomVisual) { showroomVisual.dispose(); showroomVisual = null; }
  showroomVisual = new VehicleVisual(v);
  showroomVisual.root.position.set(0, 1.5, 0);
  showroomVisual.root.rotation.x = 0.2;
  showroomGroup.add(showroomVisual.root);
  ringMat.color.setHex(v.color);
}

$('choose-vehicle-btn').onclick = () => {
  ui.menu.classList.add('hidden');
  ui.garage.classList.remove('hidden');
  showroomGroup.visible = true;
  garageIndex = VEHICLES.findIndex(v => v.id === settings.vehicleId);
  if (garageIndex === -1) garageIndex = 0;
  updateGarageUI();
};
$('garage-prev').onclick = () => { garageIndex = (garageIndex - 1 + VEHICLES.length) % VEHICLES.length; updateGarageUI(); };
$('garage-next').onclick = () => { garageIndex = (garageIndex + 1) % VEHICLES.length; updateGarageUI(); };
$('garage-select').onclick = () => { settings.vehicleId = VEHICLES[garageIndex].id; $('selected-vehicle-name').innerText = VEHICLES[garageIndex].name; $('garage-back').click(); };
$('garage-back').onclick = () => { ui.garage.classList.add('hidden'); ui.menu.classList.remove('hidden'); showroomGroup.visible = false; };

// --- RECORDS MENU ---
$('records-btn').onclick = () => {
  ui.menu.classList.add('hidden');
  ui.records.classList.remove('hidden');
  const stats = Records.getStats();
  $('rec-stats').innerHTML = `<div>Races<b>${stats.races}</b></div><div>Wins<b>${stats.wins}</b></div><div>Podiums<b>${stats.podiums}</b></div>`;
  let table = '<table><tr><th>Track</th><th>Best Lap</th><th>Vehicle</th></tr>';
  let hasData = false;
  TRACK_ORDER.forEach(id => {
    const trackRec = Records.getTrackRecords(id);
    if (trackRec.bestLap) {
      hasData = true;
      const vName = getVehicle(trackRec.bestLap.vehicle)?.name || 'Unknown';
      table += `<tr><td>${TRACKS[id].name}</td><td style="color:var(--cy)">${Records.formatTime(trackRec.bestLap.time)}</td><td>${vName}</td></tr>`;
    }
  });
  table += '</table>';
  $('rec-laps-table').innerHTML = hasData ? table : '<p style="color:#9bd; text-align:center;">No records set yet. Go race!</p>';
};
$('rec-back-btn').onclick = () => { ui.records.classList.add('hidden'); ui.menu.classList.remove('hidden'); };
$('rec-reset-btn').onclick = () => { if (confirm("Delete all records?")) { Records.resetAll(TRACK_ORDER); $('records-btn').click(); } };


// --- 4. GAME STATE & COMBAT SYSTEMS ---
let currentTrack, race, playerVisual;
let aiVisuals = new Map();
let ghostVisual = null;
let isPaused = false;
let uiTick = 0;

// Laser System
const lasers = [];
const laserGeo = new THREE.CylinderGeometry(0.15, 0.15, 8, 8);
laserGeo.rotateX(Math.PI / 2);

// Health Bubbles
const bubbles = [];
const bubbleGeo = new THREE.SphereGeometry(1.5, 16, 16);
const bubbleMat = new THREE.MeshBasicMaterial({ color: 0x00ff55, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });

function spawnBubbles(track) {
  bubbles.forEach(b => scene.remove(b.mesh));
  bubbles.length = 0;
  for (let i = 0; i < 15; i++) {
    const t = Math.random();
    const f = track.frameAt(t);
    const lat = (Math.random() - 0.5) * 8;

    const mesh = new THREE.Mesh(bubbleGeo, bubbleMat);
    mesh.position.copy(f.pos).addScaledVector(f.right, lat).addScaledVector(f.up, 2.5);
    scene.add(mesh);

    bubbles.push({ mesh, t, lat, collected: false });
  }
}

async function startGame() {
  ui.loading.classList.remove('hidden');
  ui.loading.innerText = 'LOADING ASSETS';
  sound.stopMenuMusic();
  await preloadVehicles();

  if (currentTrack && currentTrack.mesh) scene.remove(currentTrack.mesh.group);
  if (playerVisual) playerVisual.dispose();
  aiVisuals.forEach(v => v.dispose());
  aiVisuals.clear();
  if (ghostVisual) { ghostVisual.dispose(); ghostVisual = null; }
  showroomGroup.visible = false;

  lasers.forEach(l => scene.remove(l.mesh));
  lasers.length = 0;

  const trackDef = TRACKS[settings.trackId];
  currentTrack = new Track(trackDef);
  currentTrack.mesh = currentTrack.createMesh();
  scene.add(currentTrack.mesh.group);
  space.setTrack(currentTrack.curve, currentTrack.biome);

  spawnBubbles(currentTrack);

  const entries = [];
  const playerVeh = getVehicle(settings.vehicleId);
  entries.push({ id: 'player', name: 'Player 1', vehicle: playerVeh, color: playerVeh.color, isPlayer: true, gridIndex: 0 });

  if (settings.mode !== 'tt') {
    const startIdx = 1;
    for (let i = 0; i < settings.opponents; i++) {
      const v = VEHICLES[(i+1)%VEHICLES.length];
      entries.push({
        id: 'ai'+i, name: 'Player ' + (i+2), vehicle: v, color: v.color,
        isPlayer: false, skill: DIFFICULTY[settings.difficulty].skill, speedFactor: DIFFICULTY[settings.difficulty].speed,
        gridIndex: startIdx + i
      });
    }
  }

  let ghostData = null;
  if (settings.mode === 'tt') {
    ghostData = Records.loadGhost(settings.trackId);
    if (ghostData) {
      ghostVisual = new VehicleVisual(getVehicle(ghostData.vehicle), { ghost: true });
      scene.add(ghostVisual.root);
    }
  }

  race = new Race({ track: currentTrack, laps: settings.laps, entries, mode: settings.mode, difficulty: settings.difficulty, ghost: ghostData });

  playerVisual = new VehicleVisual(playerVeh);
  scene.add(playerVisual.root);

  const markerGeo = new THREE.ConeGeometry(0.5, 1, 4);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true });
  const playerMarker = new THREE.Mesh(markerGeo, markerMat);
  playerMarker.position.y = 2.5;
  playerMarker.rotation.x = Math.PI;
  playerVisual.root.add(playerMarker);

  race.racers.forEach(r => {
    if (!r.isPlayer) {
      const vis = new VehicleVisual(r.vehicle, { label: r.name });
      scene.add(vis.root);
      aiVisuals.set(r.id, vis);
    }
  });

  ui.menu.classList.add('hidden');
  ui.garage.classList.add('hidden');
  ui.records.classList.add('hidden');
  ui.results.classList.add('hidden');
  ui.pause.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  ui.loading.classList.add('hidden');
  document.getElementById('fullscreen-btn').style.display = 'none';

  isPaused = false;
  lastCount = null;

  const p = race.player;
  const fr = currentTrack.frameAt(p.progress);
  const initialPos = fr.pos.clone().addScaledVector(fr.tangent, -10).addScaledVector(fr.up, 5);
  camera.position.copy(initialPos);
  camera.lookAt(fr.pos);

  sound.startEngine();
}

function quitGame() {
  ui.hud.classList.add('hidden');
  ui.pause.classList.add('hidden');
  ui.results.classList.add('hidden');
  ui.menu.classList.remove('hidden');
  document.getElementById('fullscreen-btn').style.display = 'block';
  sound.stopEngine();
  sound.playMenuMusic();
  showroomGroup.visible = false;

  race = null;
  isPaused = false;
  if (currentTrack && currentTrack.mesh) { scene.remove(currentTrack.mesh.group); currentTrack = null; }
  if (playerVisual) { playerVisual.dispose(); playerVisual = null; }
  aiVisuals.forEach(v => v.dispose());
  aiVisuals.clear();

  lasers.forEach(l => scene.remove(l.mesh));
  lasers.length = 0;
  bubbles.forEach(b => scene.remove(b.mesh));
  bubbles.length = 0;

  space.setTrack(null);
}

$('start-btn').onclick = () => startGame();
$('pause-quit-btn').onclick = () => quitGame();
$('pause-restart-btn').onclick = () => { ui.pause.classList.add('hidden'); isPaused = false; startGame(); };
$('resume-btn').onclick = () => { ui.pause.classList.add('hidden'); isPaused = false; sound.startEngine(); };

// --- FULLSCREEN BUTTON ---
(function wireFullscreenButton() {
  const fsBtn = document.getElementById('fullscreen-btn');
  if (!fsBtn) return;

  fsBtn.addEventListener('click', () => {
    const el = document.documentElement;
    const isFs = document.fullscreenElement
      || document.webkitFullscreenElement
      || document.mozFullScreenElement
      || document.msFullscreenElement;

    if (!isFs) {
      const req = el.requestFullscreen
        || el.webkitRequestFullscreen
        || el.mozRequestFullScreen
        || el.msRequestFullscreen;
      if (req) {
        try {
          const p = req.call(el);
          if (p && p.catch) p.catch(err => console.warn('[fullscreen] request failed:', err));
          if (p && p.then) {
            p.then(() => {
              if (screen.orientation && screen.orientation.lock) {
                screen.orientation.lock('landscape').catch(() => {});
              }
            });
          }
        } catch (err) {
          console.warn('[fullscreen] request threw:', err);
        }
      }
    } else {
      const exit = document.exitFullscreen
        || document.webkitExitFullscreen
        || document.mozCancelFullScreen
        || document.msExitFullscreen;
      if (exit) {
        try {
          const p = exit.call(document);
          if (p && p.catch) p.catch(err => console.warn('[fullscreen] exit failed:', err));
        } catch (err) {
          console.warn('[fullscreen] exit threw:', err);
        }
      }
    }
  });

  const syncLabel = () => {
    const isFs = document.fullscreenElement
      || document.webkitFullscreenElement
      || document.mozFullScreenElement
      || document.msFullscreenElement;
    fsBtn.innerText = isFs ? '⛶ Exit Fullscreen' : '⛶ Fullscreen';
  };
  ['fullscreenchange','webkitfullscreenchange','mozfullscreenchange','MSFullscreenChange']
    .forEach(evt => document.addEventListener(evt, syncLabel));
})();

window.addEventListener('pointerdown', () => { sound.init(); if (!race) sound.playMenuMusic(); }, { once: true });

// --- 5. INPUT ---
const keys = { up: false, down: false, left: false, right: false, space: false, shift: false, fire: false };

function setPaused(next) {
  if (!race) return;
  if (race.phase === 'finished') return;
  if (isPaused === next) return;
  isPaused = next;
  if (isPaused) {
    ui.pause.classList.remove('hidden');
    sound.setEngine(false, 0, false);
  } else {
    ui.pause.classList.add('hidden');
    sound.startEngine();
  }
}

window.addEventListener('keydown', e => {
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') keys.up = true;
  if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keys.down = true;
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
  if (e.key === ' ') keys.space = true;
  if (e.key === 'Shift') keys.shift = true;
  if (e.key === 'f' || e.key === 'F') keys.fire = true;

  if (e.key === 'Escape' || e.key === 'Esc') {
    if (!race) return;
    if (race.phase === 'finished') return;
    e.preventDefault();
    setPaused(!isPaused);
  }
});
window.addEventListener('keyup', e => {
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') keys.up = false;
  if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') keys.down = false;
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
  if (e.key === ' ') keys.space = false;
  if (e.key === 'Shift') keys.shift = false;
  if (e.key === 'f' || e.key === 'F') keys.fire = false;
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && race && !isPaused && race.phase === 'racing') {
    setPaused(true);
  }
});

// --- TOUCH CONTROLS ---
const touchControls = document.getElementById('touch-controls');
const steerPad = document.getElementById('touch-steer');
const steerKnob = document.getElementById('touch-steer-knob');

// FORCE TOUCH CONTROLS TO SHOW
touchControls.classList.remove('hidden');

// SINGLE declaration of variables (Fix for Cloudflare build)
let steerActive = false, steerStartX = 0, steerStartY = 0, touchSteerValue = 0;

steerPad.addEventListener('touchstart', (e) => {
  e.preventDefault();
  steerActive = true;
  const t = e.touches[0];
  const rect = steerPad.getBoundingClientRect();
  steerStartX = t.clientX;
  steerStartY = t.clientY;
  steerKnob.style.left = `${t.clientX - rect.left}px`;
  steerKnob.style.top  = `${t.clientY - rect.top}px`;
  steerKnob.style.transform = `translate(-50%, -50%)`;
}, { passive: false });

steerPad.addEventListener('touchmove', (e) => {
  if (!steerActive) return;
  e.preventDefault();
  const t = e.touches[0];
  let dx = t.clientX - steerStartX;
  let dy = t.clientY - steerStartY;
  const maxDist = 55;
  const dist = Math.hypot(dx, dy);
  if (dist > maxDist) { dx = (dx / dist) * maxDist; dy = (dy / dist) * maxDist; }
  steerKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  touchSteerValue = dx / maxDist;
}, { passive: false });

const endSteer = () => {
  steerActive = false;
  touchSteerValue = 0;
  steerKnob.style.transform = `translate(-50%, -50%)`;
};
steerPad.addEventListener('touchend', endSteer);
steerPad.addEventListener('touchcancel', endSteer);

let tGas = false, tBrake = false, tDrift = false, tBoost = false, tFire = false;
const bindBtn = (id, onPress, onRelease) => {
  const el = document.getElementById(id); if(!el) return;
  el.addEventListener('touchstart', (e) => { e.preventDefault(); el.classList.add('active'); onPress(); }, { passive: false });
  el.addEventListener('touchend', (e) => { e.preventDefault(); el.classList.remove('active'); if (onRelease) onRelease(); }, { passive: false });
  el.addEventListener('touchcancel', (e) => { e.preventDefault(); el.classList.remove('active'); if (onRelease) onRelease(); }, { passive: false });
};
bindBtn('t-btn-gas', () => tGas = true, () => tGas = false);
bindBtn('t-btn-brake', () => tBrake = true, () => tBrake = false);
bindBtn('t-btn-drift', () => tDrift = true, () => tDrift = false);
bindBtn('t-btn-boost', () => tBoost = true, () => tBoost = false);
bindBtn('t-btn-fire', () => tFire = true, () => tFire = false);

function getPlayerInput() {
  let t = 0, s = 0;
  if (keys.up) t = 1;
  if (keys.down) t = -1;
  if (keys.left) s = -1;
  if (keys.right) s = 1;
  if (tGas) t = 1;
  if (tBrake) t = -1;
  if (Math.abs(touchSteerValue) > 0.1) s = touchSteerValue;
  return { throttle: t, steer: s, drift: keys.space || tDrift, boost: keys.shift || tBoost, fire: keys.fire || tFire };
}

// --- 6. UI UPDATES ---
let toastTimer = 0;
function toast(msg, dur = 2) { ui.toast.innerHTML = msg; ui.toast.classList.add('show'); toastTimer = dur; }

let lastCount = null;
function updateUI(dt) {
  if (!race) return;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) ui.toast.classList.remove('show'); }

  if (race.phase === 'countdown') {
    const n = Math.ceil(race.countdown);
    if (n !== lastCount) {
      lastCount = n;
      ui.countdown.innerText = n > 0 ? n : 'GO!';
      ui.countdown.classList.remove('hidden');
      ui.countdown.className = n > 0 ? '' : 'go';
      if (n > 0) sound.count(); else sound.go();
    }
  } else if (race.phase === 'racing') {
    if (!ui.countdown.classList.contains('hidden')) { setTimeout(() => ui.countdown.classList.add('hidden'), 800); }
  }

  uiTick += dt;
  if (uiTick > 0.1) {
    uiTick = 0;
    const p = race.player;
    if (!p) return;

    ui.lapValue.innerText = `${Math.min(settings.laps, p.lapsDone + 1)}/${settings.laps}`;
    ui.posValue.innerText = `${p.position}/${race.racers.length}`;
    const fmt = Records.formatTime;
    ui.timerValue.innerText = fmt(p.finished ? p.finishTime : race.time);
    ui.lastLap.innerText = p.lapTimes.length > 0 ? fmt(p.lapTimes[p.lapTimes.length-1]) : '--:--.--';
    ui.bestLap.innerText = p.bestLap !== Infinity ? fmt(p.bestLap) : '--:--.--';
    ui.speedValue.innerText = Math.round(p.speed * 2);

    ui.boostBar.style.width = `${p.boostMeter}%`;
    ui.boostBar.style.background = p.boosting ? 'linear-gradient(90deg, #ff0055, #ffaa00)' : 'linear-gradient(90deg, #0055ff, #00ffff)';

    ui.healthBar.style.width = `${Math.max(0, p.health)}%`;
    ui.healthBar.style.background = p.health > 50 ? 'linear-gradient(90deg, #00ff55, #aaff00)' : 'linear-gradient(90deg, #ff0055, #ffaa00)';

    ui.leaderboard.innerHTML = race.order.map((r, i) =>
      `<div class="row ${r.isPlayer ? 'me' : ''}"><div class="dot" style="background:#${r.color.toString(16).padStart(6,'0')}"></div>${i+1}. ${r.name}</div>`
    ).join('');
    drawMinimap();
  }
}

function drawMinimap() {
  const ctx = ui.minimap.getContext('2d');
  const w = ui.minimap.width, h = ui.minimap.height;
  ctx.clearRect(0, 0, w, h);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < currentTrack.N; i += 10) {
    const p = currentTrack.pos[i];
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  const rangeX = maxX - minX, rangeZ = maxZ - minZ;
  const scale = Math.min(w * 0.8 / rangeX, h * 0.8 / rangeZ);
  const ox = w/2 - (minX + rangeX/2)*scale;
  const oz = h/2 - (minZ + rangeZ/2)*scale;
  ctx.beginPath();
  for (let i = 0; i <= currentTrack.N; i++) {
    const p = currentTrack.pos[i % currentTrack.N];
    const x = p.x * scale + ox, z = p.z * scale + oz;
    if (i === 0) ctx.moveTo(x, z); else ctx.lineTo(x, z);
  }
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)'; ctx.lineWidth = 2; ctx.stroke();
  race.racers.forEach(r => {
    const fr = currentTrack.frameAt(r.progress);
    const x = fr.pos.x * scale + ox, z = fr.pos.z * scale + oz;
    ctx.beginPath(); ctx.arc(x, z, r.isPlayer ? 5 : 3, 0, Math.PI*2);
    ctx.fillStyle = r.isPlayer ? '#fff' : `#${r.color.toString(16).padStart(6,'0')}`; ctx.fill();
  });
}

// --- 7. RACE LOOP ---
const clock = new THREE.Clock();
const menuPos = new THREE.Vector3();

function animate() {
  const dt = Math.min(clock.getDelta(), 0.1);

  adaptResolution(dt);

  if (race) {
    if (isPaused) {
      sound.setEngine(false, 0, false);
    } else {
      race.update(dt, getPlayerInput());

      const events = race.drainEvents();
      for (const ev of events) {
        if (ev.type === 'shoot') {
          const shooter = ev.racer;
          const fr = currentTrack.frameAt(shooter.progress);

          const spawnPos = fr.pos.clone()
            .addScaledVector(fr.right, shooter.lateral)
            .addScaledVector(fr.tangent, 3)
            .addScaledVector(fr.up, 0.5);

          const laserMat = new THREE.MeshBasicMaterial({
            color: shooter.isPlayer ? 0x00ffff : 0xff0055,
            blending: THREE.AdditiveBlending,
            transparent: true,
            opacity: 0.9
          });

          const mesh = new THREE.Mesh(laserGeo, laserMat);
          mesh.position.copy(spawnPos);
          mesh.quaternion.copy(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.right, fr.up, fr.tangent.clone().negate())));
          scene.add(mesh);

          lasers.push({ mesh, t: shooter.progress, lat: shooter.lateral, owner: shooter.id, speed: 0.08 });

          if (shooter.isPlayer) sound.beep(800, 0.1, 'sawtooth', 0.1);
        }

        if (ev.type === 'hit' && ev.racer.isPlayer) {
          sound.wall();
          toast('HULL DAMAGED!');
        }

        if (ev.type === 'pad') { sound.pad(); if (ev.racer.isPlayer) toast('BOOST PAD!'); }

        if (ev.type === 'lap' && ev.racer.isPlayer && ev.rec) {
          Records.saveGhost(currentTrack.id, { samples: ev.rec, step: 0.05, vehicle: settings.vehicleId });
        }

        if (ev.type === 'complete') showResults();
      }

      for (let i = lasers.length - 1; i >= 0; i--) {
        const l = lasers[i];
        l.t += l.speed * dt;
        if (l.t > 1) l.t -= 1;

        const fr = currentTrack.frameAt(l.t);
        l.mesh.position.copy(fr.pos).addScaledVector(fr.right, l.lat).addScaledVector(fr.up, 0.5);

        let hit = false;
        race.racers.forEach(r => {
          if (r.id !== l.owner && !r.isDead) {
            const dr = Math.abs(r.progress - l.t);
            const dl = Math.abs(r.lateral - l.lat);
            if (dr < 0.1 && dl < 2.5) {
              r.health -= 15;
              if (r.health < 0) r.health = 0;
              hit = true;
              if (r.isPlayer) toast('HIT!');
            }
          }
        });

        if (hit || l.mesh.position.distanceTo(camera.position) > 300) {
          scene.remove(l.mesh);
          l.mesh.material.dispose();
          lasers.splice(i, 1);
        }
      }

      bubbles.forEach(b => {
        if (b.collected) return;
        const p = race.player;
        if (p && !p.isDead) {
          const dr = Math.abs(p.progress - b.t);
          const dl = Math.abs(p.lateral - b.lat);
          if (dr < 0.04 && dl < 2.5) {
            b.collected = true;
            p.health = Math.min(100, p.health + 40);
            scene.remove(b.mesh);
            sound.record();
            toast('HEALTH RESTORED!');
          }
        }
      });

      let pRatio = 0, pBoost = false;
      race.racers.forEach(r => {
        const fr = currentTrack.frameAt(r.progress);
        const pos = fr.pos.clone().addScaledVector(fr.right, r.lateral);
        const yaw = r.latVel * -0.03;
        const roll = fr.bank;

        if (r.isPlayer) {
          playerVisual.root.position.copy(pos);
          playerVisual.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.right, fr.up, fr.tangent.clone().negate()));
          playerVisual.update(r.speed / r.topSpeed, r.boosting, race.time, yaw, roll);
          const marker = playerVisual.root.children.find(c => c.geometry && c.geometry.type === 'ConeGeometry');
          if (marker) { marker.position.y = 2.5 + Math.sin(race.time * 8) * 0.2; marker.rotation.y += 0.05; }
          pRatio = r.speed / r.topSpeed;
          pBoost = r.boosting;
        } else {
          const vis = aiVisuals.get(r.id);
          if (vis) {
            vis.root.position.copy(pos);
            vis.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.right, fr.up, fr.tangent.clone().negate()));
            vis.update(r.speed / r.topSpeed, r.boosting, race.time, yaw, roll);
          }
        }
      });

      if (ghostVisual && race.ghost) {
        const gp = race.ghostPose();
        if (gp) {
          const fr = currentTrack.frameAt(gp.progress);
          ghostVisual.root.position.copy(fr.pos).addScaledVector(fr.right, gp.lateral);
          ghostVisual.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.right, fr.up, fr.tangent.clone().negate()));
          ghostVisual.root.visible = true;
        } else ghostVisual.root.visible = false;
      }

      sound.setEngine(race.phase === 'racing' || race.phase === 'finished', pRatio, pBoost);

      const p = race.player;
      if (p) {
        const fr = currentTrack.frameAt(p.progress);
        const targetPos = fr.pos.clone().addScaledVector(fr.tangent, -8 - (p.speed/p.topSpeed)*3).addScaledVector(fr.up, 3);
        camera.position.lerp(targetPos, 0.15);
        const lookAt = fr.pos.clone().addScaledVector(fr.tangent, 10).addScaledVector(fr.up, 1.5);
        camera.lookAt(lookAt);
        const targetFov = 75 + (p.speed / p.topSpeed) * 15;
        camera.fov += (targetFov - camera.fov) * 0.1;
        camera.updateProjectionMatrix();
      }
    }
  } else {
    const t = clock.elapsedTime * 0.5;
    const radius = 6;
    if (showroomGroup.visible) {
      const targetCamX = Math.sin(t) * radius + 5;
      const targetCamZ = Math.cos(t) * radius;
      menuPos.set(targetCamX, 3, targetCamZ);
      camera.position.lerp(menuPos, 0.05);
      camera.lookAt(0, 1.2, 0);
      if (showroomVisual) showroomVisual.root.rotation.y += 0.005;
    } else {
      menuPos.set(Math.sin(t * 0.2) * 150, 40, Math.cos(t * 0.2) * 150);
      camera.position.lerp(menuPos, 0.05);
      const currentLook = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
      currentLook.lerp(new THREE.Vector3(0, 0, 0), 0.05);
      camera.lookAt(currentLook);
    }
  }

  if (currentTrack && currentTrack.mesh) currentTrack.mesh.update(clock.elapsedTime, dt);
  space.update(clock.elapsedTime, camera);
  updateUI(dt);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

// --- 8. RESULTS SCREEN ---
function showResults() {
  ui.hud.classList.add('hidden');
  ui.results.classList.remove('hidden');
  ui.countdown.classList.add('hidden');
  sound.setEngine(false, 0, false);
  const res = race.results;
  const p = race.player;
  const pos = p.position;
  const titles = ['WINNER', '2ND PLACE', '3RD PLACE', '4TH PLACE', '5TH PLACE'];
  $('res-title').innerText = pos <= 3 ? titles[pos-1] : 'FINISHED';
  $('res-sub').innerText = `${currentTrack.name} • ${settings.laps} Lap${settings.laps>1?'s':''}`;
  let badges = '';
  if (pos === 1) badges += '<div class="badge">VICTORY</div>';
  if (p.bestLap === Math.min(...race.racers.map(r=>r.bestLap))) badges += '<div class="badge">FASTEST LAP</div>';
  $('res-badges').innerHTML = badges;
  let table = '<table><tr><th>Pos</th><th>Name</th><th>Time</th><th>Best Lap</th></tr>';
  res.forEach(r => {
    table += `<tr class="${r.racer.isPlayer ? 'me' : ''}">
      <td>${r.position}</td>
      <td><span class="dot" style="background:#${r.racer.color.toString(16).padStart(6,'0')}"></span>${r.racer.name}</td>
      <td>${r.time ? Records.formatTime(r.time) : 'DNF'}</td>
      <td>${r.bestLap ? Records.formatTime(r.bestLap) : '--'}</td>
    </tr>`;
  });
  table += '</table>';
  $('res-table').innerHTML = table;
  let btns = '<button id="res-again">Race Again</button><button id="res-quit">Menu</button>';
  $('res-buttons').innerHTML = btns;
  $('res-again').onclick = () => startGame();
  $('res-quit').onclick = () => quitGame();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

ui.loading.classList.add('hidden');
ui.menu.classList.remove('hidden');