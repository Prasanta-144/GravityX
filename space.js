import * as THREE from 'three';

const CONFIG = {
  sunAzimuthDeg: 14,
  sunElevationDeg: -1,
  sunAngularRadius: 0.035,
  planetDistance: 1000,
  planetRadius: 760,
  planetHorizonDeg: -2.5,
  asteroidCount: 160,
  dustCount: 700,
  dustRange: 90,
};

function dirFromAngles(azDeg, elDeg) {
  const az = THREE.MathUtils.degToRad(azDeg);
  const el = THREE.MathUtils.degToRad(elDeg);

  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    -Math.cos(az) * Math.cos(el)
  );
}

const SKY_VERT = /* glsl */`
  varying vec3 vDir;

  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */`
  precision highp float;

  varying vec3 vDir;

  uniform float uTime;
  uniform vec3 uSunDir;
  uniform float uSunSize;
  uniform vec3 uPlanetPos;
  uniform float uPlanetR;
  uniform vec3 uBandN;
  uniform float uBiome;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);

    f = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(
        mix(hash13(i), hash13(i + vec3(1,0,0)), f.x),
        mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x),
        f.y
      ),
      mix(
        mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
        mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x),
        f.y
      ),
      f.z
    );
  }

  float fbm(vec3 p) {
    float a = 0.5;
    float s = 0.0;

    for (int i = 0; i < 4; i++) {
      s += a * noise(p);
      p = p * 2.03 + 17.0;
      a *= 0.5;
    }

    return s;
  }

  vec3 starLayer(
    vec3 dir,
    float scale,
    float density,
    float size,
    float bright
  ) {
    vec3 p = dir * scale;
    vec3 id = floor(p);
    vec3 f = fract(p);

    float h = hash13(id);

    if (h > density) {
      return vec3(0.0);
    }

    vec3 off = vec3(
      hash13(id + 1.7),
      hash13(id + 5.3),
      hash13(id + 9.1)
    ) * 0.6 + 0.2;

    float d = length(f - off);
    float b = 1.0 - smoothstep(0.0, size, d);

    b *= b;

    float mag = hash13(id + 3.3);

    float tw = 0.82 + 0.18 * sin(
      uTime * (1.5 + mag * 3.0) + mag * 50.0
    );

    vec3 tint = mix(
      vec3(0.65,0.8,1.0),
      vec3(1.0,0.82,0.62),
      hash13(id + 8.8)
    );

    return tint * b * (0.5 + 1.5 * mag * mag) * tw * bright;
  }

  vec3 stars(vec3 d) {
    return
      starLayer(d,40.0,0.12,0.22,1.6) +
      starLayer(d,90.0,0.35,0.15,1.0) +
      starLayer(d,180.0,0.45,0.13,0.7);
  }

  void main() {
    vec3 dir = normalize(vDir);

    float horizon = 1.0 - smoothstep(-0.08, 0.55, dir.y);

    vec3 col;

    // EARTH: blue atmospheric gradient, moving clouds and warm horizon.
    if (uBiome > 0.5 && uBiome < 1.5) {
      float h = smoothstep(-0.22, 0.72, dir.y);

      col = mix(
        vec3(0.95,0.48,0.25),
        vec3(0.18,0.48,0.78),
        h
      );

      col = mix(
        col,
        vec3(0.035,0.16,0.38),
        smoothstep(0.35,0.95,dir.y) * 0.8
      );

      float cloudA = fbm(
        dir * 17.0 +
        vec3(uTime * 0.002, 0.0, uTime * 0.001)
      );

      float cloudB = fbm(
        dir * 34.0 -
        vec3(uTime * 0.003, 0.0, 0.0)
      );

      float clouds =
        smoothstep(
          0.56,
          0.76,
          cloudA * 0.72 + cloudB * 0.28
        ) * (0.35 + 0.65 * horizon);

      col = mix(
        col,
        vec3(0.88,0.94,1.0),
        clouds * 0.78
      );

      float sun = pow(
        max(dot(dir, normalize(uSunDir)),0.0),
        90.0
      );

      col += vec3(1.0,0.55,0.25) * sun * 0.8;

      col +=
        vec3(0.12,0.38,0.72) *
        pow(1.0 - abs(dir.y), 5.0) *
        0.22;
    }

    // ICE: cold blue sky, icy horizon glow and aurora curtains.
    else if (uBiome > 1.5) {
      float h = smoothstep(-0.35,0.8,dir.y);

      col = mix(
        vec3(0.28,0.48,0.67),
        vec3(0.015,0.055,0.16),
        h
      );

      col +=
        vec3(0.24,0.48,0.62) *
        exp(-abs(dir.y + 0.08) * 13.0) *
        0.48;

      float auroraWave = sin(
        dir.x * 8.0 +
        uTime * 0.12 +
        sin(dir.z * 5.0) * 1.4
      );

      float aurora =
        smoothstep(0.45,0.95,auroraWave) *
        smoothstep(-0.02,0.38,dir.y) *
        (1.0 - smoothstep(0.18,0.72,dir.y));

      float auroraNoise =
        0.55 +
        0.45 * fbm(
          dir * 9.0 +
          vec3(0.0,uTime * 0.025,0.0)
        );

      col +=
        mix(
          vec3(0.10,0.75,0.68),
          vec3(0.40,0.42,0.95),
          0.5 + 0.5 * sin(dir.x * 3.0)
        ) *
        aurora *
        auroraNoise *
        0.7;

      col += stars(dir) * 0.48;
    }

    // SPACE: original nebula, stars, sun and distant planet.
    else {
      float bd = dot(dir, uBandN) * 4.0;
      float band = exp(-bd * bd);

      col = mix(
        vec3(0.004,0.005,0.016),
        vec3(0.020,0.008,0.040),
        dir.y * 0.5 + 0.5
      );

      vec3 q = dir * 1.7;

      float warp = fbm(q * 1.4);
      float n1 = fbm(q + warp * 1.3);
      float n2 = fbm(q * 2.3 + 9.0);

      float neb =
        smoothstep(0.42,0.88,n1) *
        (0.35 + band * 1.1);

      vec3 nc = mix(
        vec3(0.28,0.05,0.48),
        vec3(0.0,0.34,0.55),
        n2
      );

      nc = mix(
        nc,
        vec3(0.95,0.15,0.40),
        smoothstep(0.55,0.9,n1*n2*2.0)*0.7
      );

      col += nc * neb * 0.6 + stars(dir);

      float ang = acos(
        clamp(dot(dir,uSunDir),-1.0,1.0)
      );

      float r = uSunSize;

      vec3 glow =
        vec3(1.0,0.62,0.28) *
        exp(-ang/(r*2.2)) *
        1.1 +

        vec3(1.0,0.35,0.12) *
        exp(-ang/(r*8.0)) *
        0.55 +

        vec3(0.55,0.25,0.60) /
        (1.0+pow(ang/(r*18.0),2.0)) *
        0.14;

      float disc = 1.0 - smoothstep(r*0.94,r,ang);

      float mu = sqrt(
        max(0.0,1.0-pow(ang/r,2.0))
      );

      vec3 discCol = mix(
        vec3(1.0,0.40,0.10),
        vec3(1.0,0.93,0.75),
        pow(mu,0.6)
      ) * 2.2;

      float tca = dot(uPlanetPos,dir);

      vec3 rel = dir*tca-uPlanetPos;
      float dmin = length(rel);

      if (tca > 0.0 && dmin < uPlanetR) {
        float thc = sqrt(
          uPlanetR*uPlanetR-dmin*dmin
        );

        vec3 P = dir*(tca-thc);
        vec3 n = normalize(P-uPlanetPos);

        float diff = max(dot(n,uSunDir),0.0);

        float clouds = fbm(
          n*4.0 +
          vec3(0.0,uTime*0.003,0.0)
        );

        float bands = fbm(
          vec3(n.x*3.0,n.y*12.0,n.z*3.0)
        );

        vec3 land = mix(
          vec3(0.02,0.05,0.12),
          vec3(0.06,0.13,0.24),
          bands
        );

        land = mix(
          land,
          vec3(0.50,0.60,0.78),
          smoothstep(0.55,0.78,clouds)*0.5
        );

        float fres = pow(
          1.0-max(dot(n,-dir),0.0),
          3.0
        );

        float sunSide = smoothstep(
          -0.2,
          0.85,
          dot(n,uSunDir)
        );

        vec3 atmo = mix(
          vec3(0.12,0.30,0.90),
          vec3(1.0,0.50,0.15),
          sunSide
        );

        col =
          land*(diff*1.8+0.05) +
          atmo*fres*(0.25+2.2*sunSide) +
          glow*0.5;

      } else {
        col += glow + discCol*disc;

        if (tca > 0.0) {
          float hh = (dmin-uPlanetR)/uPlanetR;

          vec3 nrm = rel/max(dmin,0.001);

          float sunSide = smoothstep(
            -0.2,
            0.85,
            dot(nrm,uSunDir)
          );

          vec3 hc = mix(
            vec3(0.12,0.30,0.90),
            vec3(1.0,0.50,0.15),
            sunSide
          );

          col += hc*(
            exp(-hh*60.0)*(0.25+2.2*sunSide) +
            exp(-hh*12.0)*0.12*(0.2+sunSide)
          );

          col +=
            vec3(1.0,0.85,0.60) *
            exp(-hh*400.0) *
            sunSide *
            1.5;
        }
      }
    }

    col +=
      (hash13(vec3(gl_FragCoord.xy,uTime))-0.5)/255.0;

    gl_FragColor = vec4(col,1.0);
  }
`;

export function createSpace(scene) {
  // Ensure fog exists before setTrack adjusts biome settings.
  if (!scene.fog) {
    scene.fog = new THREE.Fog(0x000004, 100, 1000);
  }

  const sunDirection = dirFromAngles(
    CONFIG.sunAzimuthDeg,
    CONFIG.sunElevationDeg
  );

  const planetCenterEl =
    CONFIG.planetHorizonDeg -
    THREE.MathUtils.radToDeg(
      Math.asin(CONFIG.planetRadius / CONFIG.planetDistance)
    );

  const planetPos = dirFromAngles(
    CONFIG.sunAzimuthDeg,
    planetCenterEl
  ).multiplyScalar(CONFIG.planetDistance);

  const skyUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: sunDirection },
    uSunSize: { value: CONFIG.sunAngularRadius },
    uPlanetPos: { value: planetPos },
    uPlanetR: { value: CONFIG.planetRadius },
    uBandN: {
      value: new THREE.Vector3(0.35,0.8,0.5).normalize()
    },
    uBiome: { value: 0 },
  };

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(500,48,24),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    })
  );

  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  scene.add(dome);

  const sunLight = new THREE.DirectionalLight(
    0xffa860,
    3.2
  );

  sunLight.position
    .copy(sunDirection)
    .multiplyScalar(100);

  scene.add(sunLight);

  const fillLight = new THREE.DirectionalLight(
    0x5577ff,
    1.1
  );

  fillLight.position.set(
    -sunDirection.x*50,
    60,
    -sunDirection.z*50
  );

  scene.add(fillLight);

  const hemi = new THREE.HemisphereLight(
    0x4a5cff,
    0x1a0a30,
    0.8
  );

  scene.add(hemi);

  const H = CONFIG.dustRange;

  const dustBase = new Float32Array(
    CONFIG.dustCount*3
  );

  for (let i = 0; i < dustBase.length; i++) {
    dustBase[i] = (Math.random()*2-1)*H;
  }

  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(dustBase.length);

  dustGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(dustPos,3)
  );

  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      color:0xaee0ff,
      size:0.25,
      transparent:true,
      opacity:0.55,
      blending:THREE.AdditiveBlending,
      depthWrite:false
    })
  );

  dust.frustumCulled = false;
  scene.add(dust);

  const rockGeo = new THREE.IcosahedronGeometry(1,2);
  const rp = rockGeo.attributes.position;
  const tmp = new THREE.Vector3();

  for (let i = 0; i < rp.count; i++) {
    tmp.fromBufferAttribute(rp,i);

    const k =
      1 +
      0.28 *
      Math.sin(tmp.x*2.9+tmp.y*1.7) *
      Math.sin(tmp.z*3.3+tmp.x*1.1) +
      0.12 *
      Math.sin(tmp.y*7.1+tmp.z*5.3);

    tmp.multiplyScalar(k);
    rp.setXYZ(i,tmp.x,tmp.y,tmp.z);
  }

  rockGeo.computeVertexNormals();

  const rocks = new THREE.InstancedMesh(
    rockGeo,
    new THREE.MeshStandardMaterial({
      color:0x3a3340,
      roughness:0.95,
      metalness:0,
      flatShading:true
    }),
    CONFIG.asteroidCount
  );

  rocks.count = 0;
  rocks.frustumCulled = false;
  scene.add(rocks);

  let scenery = new THREE.Group();
  scene.add(scenery);

  let activeBiome = 'space';

  function clearScenery() {
    scene.remove(scenery);

    scenery.traverse(obj => {
      if (obj.geometry) {
        obj.geometry.dispose();
      }

      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });

    scenery = new THREE.Group();
    scene.add(scenery);
  }

  function buildLandscape(curve, biome) {
    clearScenery();

    if (biome === 'space') {
      return;
    }

    const isIce = biome === 'ice';
    const samples = curve.getPoints(180);

    const geo = new THREE.ConeGeometry(
      1,
      1,
      isIce ? 5 : 7,
      1
    );

    const mat = new THREE.MeshStandardMaterial({
      color: isIce ? 0x9ed8ec : 0x526b58,
      roughness: isIce ? 0.32 : 0.92,
      metalness: isIce ? 0.12 : 0.02,
      flatShading: true,
    });

    const count = 260;

    const mountains = new THREE.InstancedMesh(
      geo,
      mat,
      count
    );

    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    const up = new THREE.Vector3(0,1,0);
    const side = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const position = new THREE.Vector3();

    let placed = 0;

    for (let i = 0; i < count; i++) {
      const t = Math.random();
      const anchor = curve.getPointAt(t);

      curve.getTangentAt(t,tangent).normalize();

      side.crossVectors(tangent,up).normalize();

      if (side.lengthSq() < 0.01) {
        side.set(1,0,0);
      }

      const sign = Math.random() < 0.5 ? -1 : 1;

      const distance =
        (isIce ? 75 : 95) +
        Math.random() * (isIce ? 210 : 260);

      position
        .copy(anchor)
        .addScaledVector(side,sign*distance);

      position.y +=
        (Math.random()-0.5) *
        (isIce ? 18 : 10);

      const radius =
        (isIce ? 16 : 22) +
        Math.random() * (isIce ? 48 : 65);

      const height =
        (isIce ? 38 : 18) +
        Math.random() * (isIce ? 105 : 52);

      rotation.setFromUnitVectors(up,up);

      rotation.setFromAxisAngle(
        up,
        Math.random()*Math.PI*2
      );

      scale.set(radius,height,radius);

      matrix.compose(position,rotation,scale);

      mountains.setMatrixAt(placed++,matrix);
    }

    mountains.count = placed;
    mountains.instanceMatrix.needsUpdate = true;

    scenery.add(mountains);

    // Broad terrain ridges add a continuous horizon behind the peaks.
    const ridgeGeo = new THREE.SphereGeometry(
      1,12,8
    );

    const ridgeMat = new THREE.MeshStandardMaterial({
      color: isIce ? 0x6faecb : 0x334b3d,
      roughness: isIce ? 0.42 : 1.0,
      metalness: isIce ? 0.08 : 0
    });

    for (let i = 0; i < 32; i++) {
      const t = i/32;
      const anchor = curve.getPointAt(t);

      curve.getTangentAt(t,tangent).normalize();

      side.crossVectors(tangent,up).normalize();

      const ridge = new THREE.Mesh(
        ridgeGeo,
        ridgeMat
      );

      const sign = i%2 ? 1 : -1;

      ridge.position
        .copy(anchor)
        .addScaledVector(
          side,
          sign*(170+Math.random()*65)
        );

      ridge.position.y -= 8;

      const w = 80+Math.random()*100;

      ridge.scale.set(
        w,
        isIce
          ? 18+Math.random()*18
          : 12+Math.random()*14,
        w*0.65
      );

      scenery.add(ridge);
    }
  }

  function setTrack(curve, biome = 'space') {
    activeBiome = biome;

    // If we are quitting, just clear the scenery and return
        if (!curve) {
          clearScenery();
          rocks.count = 0;
          rocks.instanceMatrix.needsUpdate = true;
          scene.fog.color.setHex(0x000004);
          scene.fog.near = 100;
          scene.fog.far = 1000;
          skyUniforms.uBiome.value = 0;
          return;
        }

    const earth = biome === 'earth';
    const ice = biome === 'ice';

    skyUniforms.uBiome.value =
      earth ? 1 : ice ? 2 : 0;

    if (earth) {
      scene.fog.color.setHex(0x8bbbd8);
      scene.fog.near = 180;
      scene.fog.far = 900;

      sunLight.color.setHex(0xffe0bd);
      sunLight.intensity = 2.0;

      fillLight.color.setHex(0x9bc9ff);
      fillLight.intensity = 0.85;

      hemi.color.setHex(0x9bc9ed);
      hemi.groundColor.setHex(0x52664c);
      hemi.intensity = 1.0;

      rocks.count = 0;

    } else if (ice) {
      scene.fog.color.setHex(0x8eb9d0);
      scene.fog.near = 130;
      scene.fog.far = 720;

      sunLight.color.setHex(0xb9e8ff);
      sunLight.intensity = 1.65;

      fillLight.color.setHex(0x8adfff);
      fillLight.intensity = 1.15;

      hemi.color.setHex(0x9bdcff);
      hemi.groundColor.setHex(0x253e60);
      hemi.intensity = 1.05;

      rocks.count = 0;

    } else {
      scene.fog.color.setHex(0x000004);
      scene.fog.near = 100;
      scene.fog.far = 1000;

      sunLight.color.setHex(0xffa860);
      sunLight.intensity = 3.2;

      fillLight.color.setHex(0x5577ff);
      fillLight.intensity = 1.1;

      hemi.color.setHex(0x4a5cff);
      hemi.groundColor.setHex(0x1a0a30);
      hemi.intensity = 0.8;
    }

    rocks.instanceMatrix.needsUpdate = true;

    buildLandscape(curve,biome);

    if (biome === 'space') {
      const samples = curve.getPoints(200);

      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();

      const p = new THREE.Vector3();
      const s = new THREE.Vector3();

      let placed = 0;

      for (
        let i = 0;
        i < CONFIG.asteroidCount;
        i++
      ) {
        for (let attempt = 0; attempt < 20; attempt++) {
          const size =
            2 + Math.pow(Math.random(),3)*18;

          const anchor = curve.getPointAt(
            Math.random()
          );

          const v = new THREE.Vector3(
            Math.random()-0.5,
            Math.random()-0.5,
            Math.random()-0.5
          ).normalize();

          p.copy(anchor).addScaledVector(
            v,
            35+Math.pow(Math.random(),1.5)*220
          );

          const clearance = size*1.4+22;

          let ok = true;

          for (const sp of samples) {
            if (
              sp.distanceToSquared(p) <
              clearance*clearance
            ) {
              ok = false;
              break;
            }
          }

          if (!ok) {
            continue;
          }

          e.set(
            Math.random()*6.28,
            Math.random()*6.28,
            Math.random()*6.28
          );

          q.setFromEuler(e);

          s.set(
            size,
            size*(0.6+Math.random()*0.4),
            size*(0.6+Math.random()*0.4)
          );

          m.compose(p,q,s);

          rocks.setMatrixAt(placed++,m);

          break;
        }
      }

      rocks.count = placed;
    }

    rocks.instanceMatrix.needsUpdate = true;
  }

  function update(time,camera) {
    dome.position.copy(camera.position);

    skyUniforms.uTime.value = time;

    const c = camera.position;
    const cc = [c.x,c.y,c.z];
    const D = H*2;

    for (let i = 0; i < dustBase.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        let rel = dustBase[i+a]-cc[a];

        rel -= D*Math.floor((rel+H)/D);

        dustPos[i+a] = cc[a]+rel;
      }
    }

    dustGeo.attributes.position.needsUpdate = true;

    // Dust belongs only in the original space environment.
    dust.visible = activeBiome === 'space';
  }

  return {
    sunDirection,
    setTrack,
    update
  };
}