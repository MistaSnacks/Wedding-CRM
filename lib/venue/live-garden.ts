import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { frondTexture, palmGeometry, patchMaterial, rng, waterNormals, type Tier, type WorldUniforms } from "./live-world";

/*
 * The garden around the terrace, built to the venue photos
 * (research/benavento/images: 9e4bc50e18fd, 16b71f8aca2e, 6cd85c74f01a):
 * date palms with real frond cards, a layered understory, broadleaf trees,
 * curved stepped stone terraces with potted agaves down to the lake, a fire
 * bowl in the water and a lake that mirrors the pavilion.
 */

export const LAKE = { x0: -30, x1: 30, z0: 15.5, z1: 37.6, y: -1.6 };
const STEPS = 4;

/** Front edge of terrace step i (0 = top) at x: curved, concave toward the lake. */
export function stepFront(i: number, x: number) {
  return 17.6 + i * 1.75 + 0.0042 * x * x;
}
export function stepTop(i: number) {
  return -0.22 - i * 0.36;
}

/** Half-size of the pavilion platform (plinth plus its stone rim). */
const PLATFORM = 15.2;

/**
 * True where open water is: inside the lake basin and past the lowest
 * terrace step. `r` grows the test by a radius (a trunk, a crown).
 */
export function inWater(x: number, z: number, r = 0) {
  if (x < LAKE.x0 - r || x > LAKE.x1 + r || z > LAKE.z1 + r) return false;
  return z > Math.min(stepFront(STEPS - 1, x), LAKE.z1 - 0.5) - r;
}

/**
 * True where a tree, palm or shrub may stand: on lawn, not in the lake basin
 * (water and its stone terraces), not on the pavilion platform and not on
 * the entrance walk. Every scatter uses this, so new placements stay dry.
 */
export function plantable(x: number, z: number, r = 0) {
  const inBasin = x > LAKE.x0 - r && x < LAKE.x1 + r && z > LAKE.z0 - r && z < LAKE.z1 + r;
  const onPlatform = Math.abs(x) < PLATFORM + r && Math.abs(z) < PLATFORM + r;
  const onWalk = Math.abs(x) < 2.2 + r && z < -PLATFORM + r;
  return !inBasin && !onPlatform && !onWalk;
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  draw(el.getContext("2d")!);
  const t = new THREE.CanvasTexture(el);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Fern / shrub card: leaves fanning up from the bottom centre. */
function shrubTexture() {
  const r = rng(31);
  return canvasTex(256, 256, (c) => {
    c.lineCap = "round";
    for (let i = 0; i < 46; i++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.4;
      const len = 90 + r() * 120;
      const ex = 128 + Math.cos(a) * len,
        ey = 256 + Math.sin(a) * len;
      const g = 95 + r() * 80;
      c.strokeStyle = `rgb(${45 + r() * 35},${g},${35 + r() * 25})`;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(128, 256);
      c.quadraticCurveTo(128 + Math.cos(a) * len * 0.5, 256 + Math.sin(a) * len * 0.75, ex, ey);
      c.stroke();
      // leaflets
      for (let k = 2; k < 14; k++) {
        const t = k / 14;
        const px = 128 + (ex - 128) * t,
          py = 256 + (ey - 256) * t * (0.9 + 0.1 * t);
        const s = (1 - t) * 18 + 4;
        c.fillStyle = `rgba(${55 + r() * 40},${g + r() * 30},${40 + r() * 20},0.95)`;
        c.beginPath();
        c.ellipse(px, py, s, s * 0.35, a + 1.2, 0, Math.PI * 2);
        c.ellipse(px, py, s, s * 0.35, a - 1.2, 0, Math.PI * 2);
        c.fill();
      }
    }
  });
}

/** Broadleaf canopy card: clumps of small leaves, ragged outline. */
function canopyTexture() {
  const r = rng(47);
  return canvasTex(256, 256, (c) => {
    for (let i = 0; i < 2600; i++) {
      const a = r() * Math.PI * 2,
        d = Math.sqrt(r()) * 118;
      const x = 128 + Math.cos(a) * d,
        y = 120 + Math.sin(a) * d * 0.8;
      const shade = 0.55 + 0.45 * (1 - (y - 20) / 220) + (r() - 0.5) * 0.25;
      c.fillStyle = `rgba(${Math.round(50 * shade + 10)},${Math.round(105 * shade + 20)},${Math.round(40 * shade + 8)},1)`;
      c.beginPath();
      c.ellipse(x, y, 3 + r() * 4, 2 + r() * 2.5, r() * 3, 0, Math.PI * 2);
      c.fill();
    }
  });
}

/** n vertical quads crossing at the centre, bottom at y=0, normals bent upward. */
function crossCards(w: number, h: number, n: number, lift = 0) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const g = new THREE.PlaneGeometry(w, h);
    g.translate(0, h / 2 + lift, 0);
    g.rotateY((i / n) * Math.PI);
    parts.push(g);
  }
  const m = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  const nr = m.attributes.normal;
  for (let i = 0; i < nr.count; i++) {
    const v = new THREE.Vector3(nr.getX(i) * 0.4, 1, nr.getZ(i) * 0.4).normalize();
    nr.setXYZ(i, v.x, v.y, v.z);
  }
  return m;
}

/** Trunk bases and heights from the exported palm bark mesh. */
export function palmSpots(bark: THREE.BufferGeometry) {
  const p = bark.attributes.position;
  const cells = new Map<string, { x: number; z: number; n: number }>();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > 0.8) continue;
    const x = p.getX(i),
      z = p.getZ(i);
    const k = `${Math.round(x / 1.2)},${Math.round(z / 1.2)}`;
    const c = cells.get(k) ?? { x: 0, z: 0, n: 0 };
    c.x += x;
    c.z += z;
    c.n++;
    cells.set(k, c);
  }
  // Merge neighbouring cells that belong to the same trunk.
  const raw = [...cells.values()].map((c) => ({ x: c.x / c.n, z: c.z / c.n, n: c.n }));
  const spots: { x: number; z: number; h: number }[] = [];
  for (const c of raw.sort((a, b) => b.n - a.n)) {
    if (spots.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < 1.6)) continue;
    spots.push({ x: c.x, z: c.z, h: 0 });
  }
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i),
      y = p.getY(i);
    for (const s of spots) if (y > s.h && Math.hypot(s.x - x, s.z - z) < 1.8 + y * 0.12) s.h = y;
  }
  return spots.filter((s) => s.h > 2);
}

export type Garden = {
  group: THREE.Group;
  lake: THREE.Mesh;
  lakeMirror: Reflector | null;
  fire: { light: THREE.PointLight; flame: THREE.MeshBasicMaterial };
  dispose: () => void;
};

export function buildGarden(
  u: WorldUniforms,
  tier: Tier,
  opts: { palms: { x: number; z: number; h: number }[]; size: [number, number] },
): Garden {
  const group = new THREE.Group();
  group.name = "garden";
  const r = rng(123);
  const trash: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (trash.push(x), x);
  const M = new THREE.Matrix4(),
    Q = new THREE.Quaternion(),
    P = new THREE.Vector3(),
    S = new THREE.Vector3(),
    UP = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();

  /* ---------- palms: frond cards on the GLB's trunk spots, plus a few more */
  const bark = keep(new THREE.MeshStandardMaterial({ color: "#8a7458", roughness: 0.95 }));
  patchMaterial(bark, u, { bark: true, uplight: [0.4, 2.8] });
  const frond = keep(
    new THREE.MeshStandardMaterial({
      map: keep(frondTexture()),
      color: "#d6e6b8",
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 0.7,
    }),
  );
  patchMaterial(frond, u, { wind: 5, uplight: [0.1, 4] });
  const variants = [0, 1, 2].map((k) => palmGeometry(211 + k, 10));
  variants.forEach((v) => (keep(v.trunk), keep(v.crown)));
  // The GLB has trunks on lake-side planters; drop any that would stand in
  // the basin or on the platform.
  const spots = opts.palms.filter((s) => plantable(s.x, s.z, 1));
  if (!opts.palms.length)
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const x = Math.cos(a) * 20,
        z = Math.sin(a) * 20 - (Math.sin(a) > 0.6 ? 6 : 0);
      if (plantable(x, z, 1)) spots.push({ x, z, h: 9 + r() * 3 });
    }
  const per: THREE.Matrix4[][] = [[], [], []];
  spots.forEach((s, i) => {
    const k = s.h / 10;
    per[i % 3].push(M.compose(P.set(s.x, -0.42, s.z), Q.setFromAxisAngle(UP, r() * 6.28), S.set(0.9 + r() * 0.2, k, 0.9 + r() * 0.2)).clone());
  });
  variants.forEach((v, k) => {
    for (const [geo, mat] of [
      [v.trunk, bark],
      [v.crown, frond],
    ] as const) {
      if (!per[k].length) continue;
      const im = new THREE.InstancedMesh(geo, mat, per[k].length);
      per[k].forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = tier !== "low";
      im.receiveShadow = true;
      im.frustumCulled = false;
      group.add(im);
    }
  });

  /* ---------- understory: ferns and shrubs in beds and around the lawn */
  const shrubMat = keep(
    new THREE.MeshStandardMaterial({ map: keep(shrubTexture()), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 }),
  );
  patchMaterial(shrubMat, u, { wind: 0.3, uplight: [0.05, 1] });
  const shrub = keep(crossCards(1.6, 1.1, 3));
  const count = tier === "high" ? 2600 : tier === "medium" ? 1500 : 700;
  const shrubs = new THREE.InstancedMesh(shrub, shrubMat, count);
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 6; tries++) {
    // Beds hugging the pavilion, then a looser garden out to 48 m.
    const bed = r() < 0.55;
    const x = bed ? (r() - 0.5) * 40 : (r() - 0.5) * 96;
    const z = bed ? (r() - 0.5) * 40 : (r() - 0.5) * 96;
    if (!plantable(x, z, 0.6)) continue;
    if (bed && Math.max(Math.abs(x), Math.abs(z)) > 19.5) continue;
    const sc = (bed ? 0.8 : 1) * (0.7 + r() * 0.9);
    shrubs.setMatrixAt(placed, M.compose(P.set(x, -0.44, z), Q.setFromAxisAngle(UP, r() * 6.28), S.set(sc, sc * (0.8 + r() * 0.5), sc)));
    color.setHSL(0.23 + r() * 0.07, 0.35 + r() * 0.15, 0.42 + r() * 0.2);
    shrubs.setColorAt(placed, color);
    placed++;
  }
  shrubs.count = placed;
  shrubs.castShadow = tier === "high";
  shrubs.receiveShadow = true;
  shrubs.frustumCulled = false;
  group.add(shrubs);

  /* ---------- broadleaf trees: trunk + crossed canopy cards (no blobs) */
  const canopyMat = keep(
    new THREE.MeshStandardMaterial({ map: keep(canopyTexture()), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }),
  );
  patchMaterial(canopyMat, u, { wind: 4 });
  const canopy = keep(crossCards(1, 1, 4, 0.45));
  // second, flatter layer so the crown reads round from above
  const top = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 1.15, 0);
  const crown = keep(mergeGeometries([canopy, top]));
  top.dispose();
  const trunkGeo = keep(new THREE.CylinderGeometry(0.06, 0.1, 1, 6).translate(0, 0.5, 0));
  const nTrees = tier === "low" ? 160 : 340;
  const crowns = new THREE.InstancedMesh(crown, canopyMat, nTrees);
  const trunks = new THREE.InstancedMesh(trunkGeo, bark, nTrees);
  for (let i = 0; i < nTrees; i++) {
    const a = r() * Math.PI * 2;
    const d = 30 + Math.pow(r(), 0.7) * 110;
    const x = Math.cos(a) * d,
      z = Math.sin(a) * d;
    const h = 7 + r() * 7;
    const w = 6 + r() * 5;
    // Keep the whole crown off the water, not only the trunk.
    if (!plantable(x, z, w / 2)) {
      i--;
      continue;
    }
    const rot = Q.setFromAxisAngle(UP, r() * 6.28).clone();
    crowns.setMatrixAt(i, M.compose(P.set(x, -0.42 + h * 0.35, z), rot, S.set(w, h * 0.75, w)));
    trunks.setMatrixAt(i, M.compose(P.set(x, -0.42, z), rot, S.set(h * 0.5, h * 0.6, h * 0.5)));
    color.setHSL(0.24 + r() * 0.06, 0.25 + r() * 0.15, 0.55 + r() * 0.25);
    crowns.setColorAt(i, color);
  }
  for (const im of [crowns, trunks]) {
    im.frustumCulled = false;
    im.castShadow = false;
    group.add(im);
  }

  /* ---------- curved stepped terraces down to the lake, with potted agaves */
  const stoneMat = keep(new THREE.MeshStandardMaterial({ color: "#b9a68a", roughness: 0.88 }));
  patchMaterial(stoneMat, u, { ground: true, uplight: [0.08, 1] });
  const steps: THREE.BufferGeometry[] = [];
  const N = 48;
  for (let i = 0; i < STEPS; i++) {
    const back = (x: number) => (i === 0 ? LAKE.z0 - 0.1 : stepFront(i - 1, x) - 0.05);
    const shape = new THREE.Shape();
    for (let k = 0; k <= N; k++) {
      const x = LAKE.x0 + ((LAKE.x1 - LAKE.x0) * k) / N;
      if (k === 0) shape.moveTo(x, -back(x));
      else shape.lineTo(x, -back(x));
    }
    for (let k = N; k >= 0; k--) {
      const x = LAKE.x0 + ((LAKE.x1 - LAKE.x0) * k) / N;
      shape.lineTo(x, -Math.min(stepFront(i, x), LAKE.z1 - 0.5));
    }
    const depth = stepTop(i) - LAKE.y + 0.3;
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1, curveSegments: 1 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, LAKE.y - 0.3, 0);
    steps.push(g);
  }
  // Plinth under the pavilion floor, down to the lawn.
  const plinth = new THREE.BoxGeometry(29.2, 0.5, 29.2).translate(0, -0.25, 0);
  steps.push(plinth.toNonIndexed());
  plinth.dispose();
  const stepMesh = new THREE.Mesh(keep(mergeGeometries(steps)), stoneMat);
  steps.forEach((g) => g.dispose());
  stepMesh.castShadow = stepMesh.receiveShadow = true;
  group.add(stepMesh);

  const potGeo = keep(
    new THREE.LatheGeometry(
      [
        [0.001, 0],
        [0.2, 0],
        [0.26, 0.08],
        [0.3, 0.42],
        [0.33, 0.5],
        [0.3, 0.52],
        [0.001, 0.48],
      ].map(([a, b]) => new THREE.Vector2(a, b)),
      14,
    ),
  );
  const potMat = keep(new THREE.MeshStandardMaterial({ color: "#a9785a", roughness: 0.85 }));
  const leaves: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 16; k++) {
    const leaf = new THREE.ConeGeometry(0.045, 0.6 + (k % 3) * 0.12, 4, 1);
    leaf.scale(1, 1, 0.35);
    leaf.translate(0, 0.3, 0);
    leaf.rotateX(0.35 + (k % 4) * 0.22);
    leaf.rotateY((k / 16) * Math.PI * 2 + (k % 2) * 0.2);
    leaf.translate(0, 0.48, 0);
    leaves.push(leaf);
  }
  const agaveGeo = keep(mergeGeometries(leaves));
  leaves.forEach((g) => g.dispose());
  const agaveMat = keep(new THREE.MeshStandardMaterial({ color: "#7d9a91", roughness: 0.55 }));
  const potM: THREE.Matrix4[] = [];
  for (let i = 0; i < STEPS; i++)
    for (let x = LAKE.x0 + 2; x <= LAKE.x1 - 2; x += 2.4 + (i % 2) * 0.3) {
      const xx = x + (i % 2) * 1.2;
      const z = stepFront(i, xx) - 0.55;
      if (z > LAKE.z1 - 1 || inWater(xx, z, 0.4)) continue;
      potM.push(M.compose(P.set(xx, stepTop(i), z), Q.setFromAxisAngle(UP, r() * 6.28), S.setScalar(0.9 + r() * 0.25)).clone());
    }
  for (const [geo, mat] of [
    [potGeo, potMat],
    [agaveGeo, agaveMat],
  ] as const) {
    const im = new THREE.InstancedMesh(geo, mat, potM.length);
    potM.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = tier !== "low";
    im.frustumCulled = false;
    group.add(im);
  }

  /* ---------- fire bowl in the water */
  const bowlGeo = keep(
    new THREE.LatheGeometry(
      [
        [0.001, 0],
        [1.5, 0],
        [1.6, 0.35],
        [1.75, 0.42],
        [1.75, 0.5],
        [1.2, 0.5],
        [1.1, 0.42],
        [0.001, 0.4],
      ].map(([a, b]) => new THREE.Vector2(a, b)),
      40,
    ),
  );
  const bowl = new THREE.Mesh(bowlGeo, stoneMat);
  const fireAt = new THREE.Vector3(-11, LAKE.y - 0.15, 28.5);
  bowl.position.copy(fireAt);
  bowl.castShadow = bowl.receiveShadow = true;
  const flameMat = keep(
    new THREE.MeshBasicMaterial({ color: "#ffa04a", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  const flames: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    flames.push(new THREE.ConeGeometry(0.22, 0.7 + (i % 3) * 0.25, 6, 1, true).translate(Math.cos(a) * 0.6, 0.8, Math.sin(a) * 0.6));
  }
  flames.push(new THREE.ConeGeometry(0.4, 1.3, 8, 1, true).translate(0, 1.0, 0));
  const flame = new THREE.Mesh(keep(mergeGeometries(flames)), flameMat);
  flames.forEach((g) => g.dispose());
  flame.position.copy(fireAt);
  const light = new THREE.PointLight("#ff9a4a", 0, 14, 1.8);
  light.position.copy(fireAt).add(new THREE.Vector3(0, 1.4, 0));
  group.add(bowl, flame, light);

  /* ---------- lake: planar reflection on high tier, environment otherwise */
  const lakeGeo = keep(new THREE.PlaneGeometry(LAKE.x1 - LAKE.x0, LAKE.z1 - LAKE.z0));
  let lake: THREE.Mesh;
  let lakeMirror: Reflector | null = null;
  const normals = keep(waterNormals());
  if (tier === "high") {
    lakeMirror = new Reflector(lakeGeo, {
      textureWidth: Math.round(opts.size[0] * 0.5),
      textureHeight: Math.round(opts.size[1] * 0.5),
      clipBias: 0.003,
      multisample: 0,
      shader: {
        name: "LakeMirror",
        uniforms: {
          color: { value: null },
          tDiffuse: { value: null },
          textureMatrix: { value: null },
          tNormal: { value: normals },
          uTime: u.uTime,
          uDeep: { value: new THREE.Color("#183a30") },
          uLight: { value: 1 },
        },
        vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW; varying vec2 vT;
void main(){ vUv = textureMatrix * vec4(position,1.0); vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; vT = w.xz;
gl_Position = projectionMatrix*viewMatrix*w; }`,
        fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tNormal; uniform float uTime; uniform vec3 uDeep; uniform float uLight;
varying vec4 vUv; varying vec3 vW; varying vec2 vT;
void main(){
  vec3 n1 = texture2D(tNormal, vT * 0.09 + vec2(uTime * 0.012, uTime * 0.007)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tNormal, vT * 0.23 - vec2(uTime * 0.009, -uTime * 0.011)).xyz * 2.0 - 1.0;
  vec2 d = (n1.xy + n2.xy) * 0.012;
  vec3 refl = texture2DProj(tDiffuse, vec4(vUv.xy + d * vUv.w, vUv.zw)).rgb;
  vec3 v = normalize(cameraPosition - vW);
  float f = 0.06 + 0.94 * pow(1.0 - clamp(v.y, 0.0, 1.0), 4.0);
  gl_FragColor = vec4(mix(uDeep * uLight, refl, clamp(f * 1.1 + 0.25, 0.0, 0.95)), 1.0);
}`,
      },
    });
    lake = lakeMirror;
  } else {
    const n = normals.clone();
    n.repeat.set(6, 2);
    keep(n);
    lake = new THREE.Mesh(
      lakeGeo,
      keep(
        new THREE.MeshPhysicalMaterial({
          color: "#16372c",
          roughness: 0.04,
          normalMap: n,
          normalScale: new THREE.Vector2(0.25, 0.25),
          envMapIntensity: 1.6,
        }),
      ),
    );
  }
  lake.rotation.x = -Math.PI / 2;
  lake.position.set((LAKE.x0 + LAKE.x1) / 2, LAKE.y, (LAKE.z0 + LAKE.z1) / 2);
  lake.receiveShadow = true;
  group.add(lake);

  return {
    group,
    lake,
    lakeMirror,
    fire: { light, flame: flameMat },
    dispose: () => {
      trash.forEach((t) => t.dispose());
      lakeMirror?.dispose();
    },
  };
}
