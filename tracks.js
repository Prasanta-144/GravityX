import * as THREE from 'three';

// MOBILE: cheaper material on phones
const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const StandardMat = isMobile ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial;

export const TRACK_WIDTH = 12;
export const MAX_LATERAL = TRACK_WIDTH / 2 - 1;

const BANK_K = 70;
const MAX_BANK = 0.55;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export const TRACKS = {
  training: {
    id: 'training',
    name: 'Training Loop',
    difficulty: 1,
    description: 'A wide, flowing oval in deep space. Learn the ropes.',
    biome: 'space',
    shape: {
      rx: 500, rz: 340, samples: 30,
      radial: [[2, 0.10, 0.5], [3, 0.06, 1.2]],
      elevation: [[1, 22, 0], [2, 10, 1]],
    },
  },
  speedway: {
    id: 'speedway',
    name: 'Earth Orbit',
    difficulty: 2,
    description: 'A twisting, winding circuit high above the clouds.',
    biome: 'earth',
    shape: {
      rx: 400, rz: 400, samples: 40,
      radial: [[3, 0.15, 0.2], [5, 0.08, 1.5]],
      elevation: [[2, 15, 0.4], [3, 5, 2]],
    },
  },
  abyss: {
    id: 'abyss',
    name: 'Ice Planet',
    difficulty: 3,
    description: 'Massive sweeping curves across a frozen wasteland.',
    biome: 'ice',
    shape: {
      rx: 700, rz: 500, samples: 36,
      radial: [[2, 0.12, 0], [4, 0.05, 1]],
      elevation: [[1, 80, 1], [3, 20, 0.2]],
    },
  },
};
export const TRACK_ORDER = Object.keys(TRACKS);

const DEFAULT_PADS = [
  [0.10, -2.5], [0.28, 2.5], [0.45, 0],
  [0.62, -2.5], [0.80, 2.5], [0.92, 0]
];

function shapePoints(s) {
  const n = s.samples || 32;
  const pts = [];

  for (let k = 0; k < n; k++) {
    const th = (Math.PI * 2 * k) / n;
    let r = 1;

    for (const [h, a, ph] of s.radial || []) {
      r += a * Math.sin(h * th + ph);
    }

    let y = 0;
    for (const [h, a, ph] of s.elevation || []) {
      y += a * Math.sin(h * th + ph);
    }

    pts.push(
      new THREE.Vector3(
        -s.rx * Math.cos(th) * r,
        y,
        -s.rz * Math.sin(th) * r
      )
    );
  }

  return pts;
}

function boxBlur(arr, w) {
  const n = arr.length;
  const out = new Array(n);

  for (let i = 0; i < n; i++) {
    let s = 0;

    for (let k = -w; k <= w; k++) {
      s += arr[(i + k + n * 4) % n];
    }

    out[i] = s / (2 * w + 1);
  }

  return out;
}

export class Frame {
  constructor() {
    this.pos = new THREE.Vector3();
    this.tangent = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.right = new THREE.Vector3(1, 0, 0);
    this.kappa = 0;
    this.bank = 0;
  }
}

export class Track {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.biome = def.biome || 'space';

    let pts = def.points
      ? def.points.map(p =>
          Array.isArray(p)
            ? new THREE.Vector3(p[0], p[1], p[2])
            : p.clone()
        )
      : shapePoints(def.shape);

    const c0 = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    const t0 = c0.getTangentAt(0);
    const phi = Math.atan2(t0.x, -t0.z);
    const o = pts[0].clone();

    pts = pts.map(p =>
      p.clone().sub(o).applyAxisAngle(Y_AXIS, phi)
    );

    this.curve = new THREE.CatmullRomCurve3(
      pts,
      true,
      'centripetal'
    );

    this.curve.arcLengthDivisions = 2000;
    this.curve.updateArcLengths();
    this.length = this.curve.getLength();

    const N = (this.N = Math.max(64, Math.ceil(this.length / 2)));

    this.pos = [];
    this.tan = [];

    for (let i = 0; i < N; i++) {
      this.pos.push(this.curve.getPointAt(i / N));
      this.tan.push(
        this.curve.getTangentAt(i / N).normalize()
      );
    }

    const ds = this.length / N;
    const raw = new Array(N);

    for (let i = 0; i < N; i++) {
      const a = this.tan[i];
      const b = this.tan[(i + 1) % N];

      raw[i] = (a.z * b.x - a.x * b.z) / ds;
    }

    this.kap = boxBlur(raw, 2);

    const bankSrc = boxBlur(
      raw,
      Math.max(2, Math.round(30 / ds))
    );

    this.bnk = bankSrc.map(k =>
      THREE.MathUtils.clamp(-k * BANK_K, -MAX_BANK, MAX_BANK)
    );

    this.up = [];
    this.rgt = [];

    const q = new THREE.Quaternion();
    let prevUp = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < N; i++) {
      const t = this.tan[i];

      let u = Y_AXIS.clone().addScaledVector(
        t,
        -Y_AXIS.dot(t)
      );

      if (u.lengthSq() < 1e-3) {
        u = prevUp.clone().addScaledVector(
          t,
          -prevUp.dot(t)
        );
      }

      u.normalize();

      q.setFromAxisAngle(t, this.bnk[i]);
      u.applyQuaternion(q).normalize();

      const r = new THREE.Vector3()
        .crossVectors(t, u)
        .normalize();

      u = new THREE.Vector3()
        .crossVectors(r, t)
        .normalize();

      this.up.push(u);
      this.rgt.push(r);
      prevUp = u;
    }

    this.pads = (def.pads || DEFAULT_PADS).map(([t, lat]) => ({
      t,
      lat,
      s: t * this.length
    }));

    this._f = new Frame();
  }

  makeFrame() {
    return new Frame();
  }

  frameAt(progress, out = new Frame()) {
    const t = progress - Math.floor(progress);
    const f = t * this.N;

    let i = Math.floor(f);
    if (i >= this.N) i = this.N - 1;

    const u = f - i;
    const j = (i + 1) % this.N;

    out.pos.lerpVectors(this.pos[i], this.pos[j], u);

    out.tangent
      .lerpVectors(this.tan[i], this.tan[j], u)
      .normalize();

    out.up
      .lerpVectors(this.up[i], this.up[j], u)
      .normalize();

    out.right
      .crossVectors(out.tangent, out.up)
      .normalize();

    out.up.crossVectors(out.right, out.tangent);

    out.kappa =
      this.kap[i] * (1 - u) + this.kap[j] * u;

    out.bank =
      this.bnk[i] * (1 - u) + this.bnk[j] * u;

    return out;
  }

  kappaAt(progress) {
    const t = progress - Math.floor(progress);

    return this.kap[
      Math.min(this.N - 1, Math.floor(t * this.N))
    ];
  }

  worldPosition(
    progress,
    lateral,
    lift,
    out = new THREE.Vector3()
  ) {
    const f = this.frameAt(progress, this._f);

    return out
      .copy(f.pos)
      .addScaledVector(f.right, lateral)
      .addScaledVector(f.up, lift);
  }

  createMesh() {
    const W = TRACK_WIDTH;
    const L = this.length;
    const N = this.N;

    const group = new THREE.Group();
    const textures = [];

    const tex = (c, repeatY) => {
      const t = new THREE.CanvasTexture(c);

      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;

      if (repeatY) {
        t.wrapT = THREE.RepeatWrapping;
      }

      textures.push(t);
      return t;
    };

    const canvas = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    };

    const rc = canvas(256, 256);
    const rg = rc.getContext('2d');

    if (this.biome === 'earth') {
      rg.fillStyle = '#292d32';
      rg.fillRect(0, 0, 256, 256);

      rg.fillStyle = 'rgba(255,255,255,0.035)';

      for (let y = 0; y < 256; y += 9) {
        for (let x = 0; x < 256; x += 13) {
          rg.fillRect(
            x + ((y / 9) % 2) * 4,
            y,
            2,
            2
          );
        }
      }

      rg.fillStyle = '#f4f1df';
      rg.fillRect(15, 0, 5, 256);
      rg.fillRect(236, 0, 5, 256);

      rg.fillStyle = '#f5d76e';

      for (let y = 0; y < 256; y += 64) {
        rg.fillRect(126, y + 8, 4, 34);
      }

      rg.fillStyle = 'rgba(0,0,0,0.18)';
      rg.fillRect(0, 0, 8, 256);
      rg.fillRect(248, 0, 8, 256);

    } else if (this.biome === 'ice') {
      const iceGrad = rg.createLinearGradient(
        0, 0, 256, 256
      );

      iceGrad.addColorStop(0, '#8bd8ed');
      iceGrad.addColorStop(0.48, '#397fba');
      iceGrad.addColorStop(1, '#b9f1f7');

      rg.fillStyle = iceGrad;
      rg.fillRect(0, 0, 256, 256);

      rg.fillStyle = 'rgba(230,252,255,0.35)';
      rg.fillRect(12, 0, 5, 256);
      rg.fillRect(239, 0, 5, 256);

      rg.strokeStyle = 'rgba(225,250,255,0.38)';
      rg.lineWidth = 2;

      for (let y = 12; y < 256; y += 48) {
        rg.beginPath();
        rg.moveTo(24, y);
        rg.lineTo(92, y + 13);
        rg.lineTo(126, y - 4);
        rg.lineTo(174, y + 12);
        rg.lineTo(230, y - 2);
        rg.stroke();
      }

      rg.strokeStyle = 'rgba(15,75,130,0.28)';
      rg.lineWidth = 3;

      for (let y = 32; y < 256; y += 72) {
        rg.beginPath();
        rg.moveTo(40, y);
        rg.lineTo(76, y + 22);
        rg.lineTo(65, y + 45);
        rg.stroke();
      }

      rg.fillStyle = 'rgba(255,255,255,0.7)';

      for (let y = 0; y < 256; y += 128) {
        rg.fillRect(124, y + 16, 8, 48);
      }

    } else {
      rg.fillStyle = '#0a0c1c';
      rg.fillRect(0, 0, 256, 256);

      rg.fillStyle = 'rgba(70,110,200,0.10)';

      for (let y = 0; y < 256; y += 32) {
        rg.fillRect(14, y, 228, 2);
      }

      rg.fillStyle = '#00e5ff';
      rg.fillRect(5, 0, 7, 256);

      rg.fillStyle = '#ff2a7a';
      rg.fillRect(244, 0, 7, 256);

      rg.fillStyle = 'rgba(190,225,255,0.85)';

      for (let y = 0; y < 256; y += 128) {
        rg.fillRect(124, y + 16, 8, 64);
      }

      rg.fillStyle = 'rgba(0,229,255,0.25)';
      rg.fillRect(80, 0, 2, 256);
      rg.fillRect(174, 0, 2, 256);
    }

    const roadTex = tex(rc, true);

    let trackColor = 0x0a0a1a;
    let emissiveColor = 0x001133;
    let roadMetalness = 0.3;
    let roadRoughness = 0.6;
    let roadEmissiveIntensity = 0.75;

    if (this.biome === 'earth') {
      trackColor = 0xffffff;
      emissiveColor = 0x000000;
      roadMetalness = 0.02;
      roadRoughness = 0.94;
      roadEmissiveIntensity = 0;

    } else if (this.biome === 'ice') {
      trackColor = 0xc9f5ff;
      emissiveColor = 0x174c78;
      roadMetalness = 0.42;
      roadRoughness = 0.22;
      roadEmissiveIntensity = 0.32;
    }

    // MOBILE: StandardMat is MeshLambertMaterial on phones, MeshStandardMaterial on desktop
    const roadMat = new StandardMat({
      map: roadTex,
      emissive: emissiveColor,
      emissiveMap: this.biome === 'space' ? roadTex : null,
      emissiveIntensity: roadEmissiveIntensity,
      metalness: roadMetalness,
      roughness: roadRoughness,
      side: THREE.DoubleSide,
      color: trackColor
    });

    const tiles = Math.max(1, Math.round(L / 16));

    const verts = [];
    const norms = [];
    const uvs = [];
    const idx = [];

    for (let i = 0; i <= N; i++) {
      const k = i % N;
      const p = this.pos[k];
      const r = this.rgt[k];
      const u = this.up[k];
      const v = (i / N) * tiles;

      verts.push(
        p.x - r.x * W / 2,
        p.y - r.y * W / 2,
        p.z - r.z * W / 2,

        p.x + r.x * W / 2,
        p.y + r.y * W / 2,
        p.z + r.z * W / 2
      );

      norms.push(
        u.x, u.y, u.z,
        u.x, u.y, u.z
      );

      uvs.push(0, v, 1, v);

      if (i < N) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;

        idx.push(a, b, c, b, d, c);
      }
    }

    const rGeo = new THREE.BufferGeometry();

    rGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(verts, 3)
    );

    rGeo.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(norms, 3)
    );

    rGeo.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(uvs, 2)
    );

    rGeo.setIndex(idx);

    group.add(new THREE.Mesh(rGeo, roadMat));

    const mkRail = (side, color) => {
      const pts = [];

      for (let i = 0; i < N; i += 3) {
        pts.push(
          this.pos[i].clone()
            .addScaledVector(
              this.rgt[i],
              side * (W / 2 + 0.15)
            )
            .addScaledVector(this.up[i], 0.25)
        );
      }

      const curve = new THREE.CatmullRomCurve3(
        pts,
        true
      );

      const railMaterial = this.biome === 'earth'
        ? new StandardMat({
            color,
            metalness: 0.78,
            roughness: 0.38
          })
        : new StandardMat({
            color,
            emissive: color,
            emissiveIntensity:
              this.biome === 'ice' ? 0.65 : 2
          });

      return new THREE.Mesh(
        new THREE.TubeGeometry(
          curve,
          pts.length * 2,
          0.18,
          6,
          true
        ),
        railMaterial
      );
    };

    const railColorL =
      this.biome === 'ice'
        ? 0x9beeff
        : this.biome === 'earth'
          ? 0x9aa5ad
          : 0x00e5ff;

    const railColorR =
      this.biome === 'ice'
        ? 0xd8fbff
        : this.biome === 'earth'
          ? 0x9aa5ad
          : 0xff2a7a;

    group.add(
      mkRail(-1, railColorL),
      mkRail(1, railColorR)
    );

    if (this.biome === 'earth') {
      const postMat = new StandardMat({
        color: 0x737e86,
        metalness: 0.72,
        roughness: 0.42
      });

      const postGeo = new THREE.CylinderGeometry(
        0.12, 0.16, 1.05, 6
      );

      for (
        let i = 0;
        i < N;
        i += Math.max(1, Math.floor(N / 90))
      ) {
        for (const side of [-1, 1]) {
          const post = new THREE.Mesh(postGeo, postMat);

          post.position.copy(this.pos[i])
            .addScaledVector(
              this.rgt[i],
              side * (W / 2 + 0.2)
            )
            .addScaledVector(this.up[i], 0.58);

          group.add(post);
        }
      }
    }

    const basisQuat = (f, out) =>
      out.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(
          f.right,
          f.up,
          f.tangent.clone().negate()
        )
      );

    const f = new Frame();

    const pc = canvas(128, 256);
    const pg = pc.getContext('2d');

    pg.clearRect(0, 0, 128, 256);

    for (let k = 0; k < 2; k++) {
      const y0 = k * 128;

      const grad = pg.createLinearGradient(
        0, y0, 0, y0 + 128
      );

      grad.addColorStop(0, 'rgba(255,170,0,0.95)');
      grad.addColorStop(1, 'rgba(255,90,0,0.2)');

      pg.fillStyle = grad;
      pg.beginPath();

      pg.moveTo(64, y0 + 14);
      pg.lineTo(120, y0 + 76);
      pg.lineTo(120, y0 + 108);
      pg.lineTo(64, y0 + 46);
      pg.lineTo(8, y0 + 108);
      pg.lineTo(8, y0 + 76);

      pg.closePath();
      pg.fill();
    }

    const padTex = tex(pc, true);
    const padGeo = new THREE.PlaneGeometry(5, 8);
    const pads = [];

    this.pads.forEach((pad, i) => {
      this.frameAt(pad.t, f);

      const m = new THREE.Mesh(
        padGeo,
        new THREE.MeshBasicMaterial({
          map: padTex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      );

      m.position.copy(f.pos)
        .addScaledVector(f.right, pad.lat)
        .addScaledVector(f.up, 0.12);

      basisQuat(f, m.quaternion);
      m.rotateX(-Math.PI / 2);

      group.add(m);
      pads.push({ mesh: m, flash: 0 });
    });

    const cc = canvas(256, 64);
    const cg = cc.getContext('2d');

    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 16; x++) {
        cg.fillStyle =
          (x + y) % 2 ? '#ffffff' : '#111111';

        cg.fillRect(
          x * 16,
          y * 16,
          16,
          16
        );
      }
    }

    const checkTex = tex(cc, false);

    this.frameAt(0, f);

    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(W, 3),
      new THREE.MeshBasicMaterial({
        map: checkTex,
        side: THREE.DoubleSide
      })
    );

    line.position.copy(f.pos)
      .addScaledVector(f.up, 0.1);

    basisQuat(f, line.quaternion);
    line.rotateX(-Math.PI / 2);

    group.add(line);

    return {
      group,

      update: (time, dt) => {
        padTex.offset.y -= dt * 1.2;
      },

      flashPad: (i) => {
        if (pads[i]) {
          pads[i].flash = 0.5;
        }
      },

      dispose: () => {
        const geos = new Set();
        const mats = new Set();

        group.traverse(o => {
          if (o.geometry) geos.add(o.geometry);
          if (o.material) mats.add(o.material);
        });

        geos.forEach(g => g.dispose());
        mats.forEach(m => m.dispose());
        textures.forEach(t => t.dispose());
      },
    };
  }
}