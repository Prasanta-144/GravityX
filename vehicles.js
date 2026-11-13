import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// MOBILE: cheaper material on phones
const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const StandardMat = isMobile ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial;

export const VEHICLES = [
  {
    id: 'phantom', name: 'Phantom', desc: 'Balanced all-rounder. Good at everything.',
    model: '/spaceship.glb', modelRotationY: Math.PI, length: 4, color: 0x00ffff,
    stats: { speed: 1.0, accel: 1.0, handling: 1.0, boost: 1.0 },
  },
  {
    id: 'comet', name: 'Comet', desc: 'Fastest top speed, but slow off the line and twitchy.',
    model: '/comet.glb', modelRotationY: Math.PI, length: 4, color: 0xff7a00,
    stats: { speed: 1.08, accel: 0.92, handling: 0.9, boost: 1.0 },
  },
  {
    id: 'nova', name: 'Nova', desc: 'Razor handling and quick acceleration, lower top speed.',
    model: '/nova.glb', modelRotationY: Math.PI, length: 4, color: 0xff2a7a,
    stats: { speed: 0.95, accel: 1.08, handling: 1.1, boost: 1.0 },
  },
  {
    id: 'titan', name: 'Titan', desc: 'Heavy and stable, with a huge boost reserve.',
    model: '/titan.glb', modelRotationY: Math.PI, length: 4, color: 0x66ff33,
    stats: { speed: 1.0, accel: 0.9, handling: 0.85, boost: 1.25 },
  },
];
export const getVehicle = (id) => VEHICLES.find(v => v.id === id) || VEHICLES[0];

/* ---------------- model loading ---------------- */
const loader = new GLTFLoader();
const modelCache = new Map();

function loadModel(def) {
  if (!def.model) return Promise.resolve(null);
  if (!modelCache.has(def.model)) {
    modelCache.set(def.model, new Promise((resolve) => {
      loader.load(def.model, (gltf) => resolve(gltf.scene), undefined, () => {
        console.warn(`[vehicles] ${def.model} not found - using fallback.`);
        resolve(null);
      });
    }));
  }
  return modelCache.get(def.model).then((scene) => {
    if (!scene) return null;
    const model = scene.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());

    const k = (def.length || 4) / Math.max(size.x, size.y, size.z, 1e-6);
    const center = box.getCenter(new THREE.Vector3());
    model.scale.setScalar(k);
    model.position.set(-center.x * k, -center.y * k, -center.z * k);

    const wrap = new THREE.Group();
    wrap.add(model);
    wrap.rotation.y = def.modelRotationY ?? Math.PI;
    wrap.userData.shared = true;
    return wrap;
  });
}

export function preloadVehicles() { return Promise.all(VEHICLES.map(loadModel)); }

/* ---------------- fallback procedural ships ---------------- */
function buildProcedural(def, color) {
  const g = new THREE.Group();
  const hull = new StandardMat({ color: 0x23273d, metalness: 0.75, roughness: 0.3, emissive: color, emissiveIntensity: 0.12 });
  const trim = new THREE.MeshBasicMaterial({ color, emissive: color, emissiveIntensity: 2.0 });

  const type = def.id || 'phantom';

  if (type === 'comet') {
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.4, 4.5, 4), hull);
    body.rotation.x = -Math.PI / 2; body.rotation.y = Math.PI / 4; g.add(body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.05, 0.8), hull);
    wing.position.set(0, -0.1, 0.5); g.add(wing);
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2), trim);
    t1.position.set(-1.5, 0, 1); t1.rotation.y = 0.4; g.add(t1);
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2), trim);
    t2.position.set(1.5, 0, 1); t2.rotation.y = -0.4; g.add(t2);
  } else if (type === 'nova') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 3, 6), hull);
    body.rotation.x = Math.PI / 2; g.add(body);
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const w = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 0.8), hull);
      w.position.set(Math.cos(angle) * 1.2, Math.sin(angle) * 1.2, 0.5);
      w.rotation.z = angle; g.add(w);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1), trim);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(Math.cos(angle) * 2.4, Math.sin(angle) * 2.4, 0.5);
      g.add(tip);
    }
  } else if (type === 'titan') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 3), hull);
    g.add(body);
    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3, 8), hull);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(side * 1.2, 0, 0.2); g.add(pod);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 8), trim);
      glow.position.set(side * 1.2, 0, 1.7); g.add(glow);
    }
  } else {
    const fus = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.6, 6), hull);
    fus.rotation.x = -Math.PI / 2; g.add(fus);
  }

  g.userData.rearZ = 1.8;
  return g;
}

const GHOST_MAT = new THREE.MeshBasicMaterial({ color: 0x66ffff, transparent: true, opacity: 0.28, depthWrite: false });

function makeLabel(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,10,30,0.55)'; g.fillRect(8, 8, 240, 48);
  g.fillStyle = '#' + new THREE.Color(color).getHexString();
  g.fillText(text.toUpperCase(), 128, 34);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(5, 1.25, 1);
  sp.position.set(0, 2.1, 0);
  return sp;
}

export class VehicleVisual {
  constructor(def, { color = def.color, ghost = false, label = null } = {}) {
    this.def = def;
    this.ghost = ghost;
    this.color = new THREE.Color(color);
    this.disposed = false;

    this.root = new THREE.Group();
    this.model = new THREE.Group();
    this.root.add(this.model);

    this.rearZ = 1.8;
    this._setContent(buildProcedural(def, this.color));

    this.flameMat = new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.9 });
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.5, 8), this.flameMat);
    this.flame.rotation.x = Math.PI / 2;
    this.root.add(this.flame);

    this.glowMat = new THREE.MeshBasicMaterial({
      color: this.color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.glow = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.7, 28), this.glowMat);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = -0.55;
    this.root.add(this.glow);

    if (ghost) { this.flame.visible = false; this.glow.visible = false; }
    if (label) { this.label = makeLabel(label, this.color); this.root.add(this.label); }

    loadModel(def).then((m) => { if (m && !this.disposed) { this.rearZ = def.length / 2; this._setContent(m); } });
  }

  _setContent(obj) {
    for (const c of [...this.model.children]) {
      this.model.remove(c);
      if (!c.userData.shared) this._disposeTree(c);
    }
    if (obj.userData.rearZ) this.rearZ = obj.userData.rearZ;
    this.model.add(obj);
    if (this.ghost) obj.traverse(o => { if (o.isMesh) o.material = GHOST_MAT; });
  }

  _disposeTree(o) {
    o.traverse(n => {
      if (n.geometry) n.geometry.dispose();
      if (n.material && n.material !== GHOST_MAT) n.material.dispose();
    });
  }

  update(speedRatio, boosting, time, yaw = 0, roll = 0) {
    const s = 0.6 + Math.max(0, speedRatio) * 1.4 + (boosting ? 0.8 : 0);
    this.flame.scale.set(1, s, 1);
    this.flame.position.set(0, 0, this.rearZ + 0.75 * s);
    this.flameMat.color.setHex(boosting ? 0xffaa00 : this.color.getHex());
    this.glowMat.opacity = 0.35 + 0.15 * Math.sin(time * 4);
    this.model.rotation.set(0, yaw, roll);
  }

  dispose() {
    this.disposed = true;
    for (const c of this.model.children) if (!c.userData.shared) this._disposeTree(c);
    this.flame.geometry.dispose(); this.flameMat.dispose();
    this.glow.geometry.dispose(); this.glowMat.dispose();
    if (this.label) { this.label.material.map.dispose(); this.label.material.dispose(); }
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}