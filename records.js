/* ============================================================
   RECORDS  -  best laps, best race times per lap-count, ghosts,
   career stats. Everything lives in localStorage and every
   access is guarded, so the game still runs if storage is blocked.
   ============================================================ */

const KEY = 'gravx_records_v2';
const SETTINGS_KEY = 'gravx_settings_v2';
const ghostKey = (trackId) => `gravx_ghost_v2_${trackId}`;

const blank = () => ({ tracks: {}, stats: { races: 0, wins: 0, podiums: 0, championships: 0 } });

function read(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: ignore */ }
}

let data = read(KEY) || blank();
if (!data.tracks) data = blank();
const save = () => write(KEY, data);
const entry = (trackId) => (data.tracks[trackId] ||= { bestLap: null, bestRace: {} });

export function formatTime(t) {
  if (t == null || !isFinite(t)) return '--:--.--';
  const cs = Math.floor(t * 100 + 1e-6);
  const m = Math.floor(cs / 6000), s = Math.floor(cs / 100) % 60, c = cs % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

export function getTrackRecords(trackId) { return entry(trackId); }
export function getStats() { return data.stats; }

/** @returns {boolean} true when this lap is a new track record */
export function submitLap(trackId, time, vehicleId) {
  const e = entry(trackId);
  if (!e.bestLap || time < e.bestLap.time) {
    e.bestLap = { time, vehicle: vehicleId, date: Date.now() };
    save();
    return true;
  }
  return false;
}

/** @returns {boolean} true when this is a new best for that lap count */
export function submitRace(trackId, laps, time, vehicleId) {
  const e = entry(trackId), cur = e.bestRace[laps];
  if (!cur || time < cur.time) {
    e.bestRace[laps] = { time, vehicle: vehicleId, date: Date.now() };
    save();
    return true;
  }
  return false;
}

export function addRaceResult(position) {
  const s = data.stats;
  s.races++;
  if (position === 1) s.wins++;
  if (position <= 3) s.podiums++;
  save();
}
export function addChampionship() { data.stats.championships++; save(); }

export function saveGhost(trackId, ghost) { write(ghostKey(trackId), ghost); }
export function loadGhost(trackId) {
  const g = read(ghostKey(trackId));
  return g && Array.isArray(g.samples) && g.samples.length > 2 ? g : null;
}

export function loadSettings() { return read(SETTINGS_KEY) || {}; }
export function saveSettings(s) { write(SETTINGS_KEY, s); }

export function resetAll(trackIds = []) {
  data = blank(); save();
  try { trackIds.forEach(id => localStorage.removeItem(ghostKey(id))); } catch { /* ignore */ }
}
