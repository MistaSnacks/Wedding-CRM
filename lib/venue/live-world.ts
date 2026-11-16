import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { palmSpots, plantable } from "./live-garden";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/*
 * The world around the live tables: the Blender-authored Benavento shell
 * (graphite steel, mirrored clerestory, grey marble, date palms, stepped
 * lake-side planters) with upgraded materials, plus a procedural backdrop
 * (palms, tree belt, layered hills) that gives the horizon depth.
 * Photo reference: research/benavento/images (terrace and lake sets).
 */

export const SHELL_URL = "/venue/benavento-terrace-detailed.glb";
export const HDR_URL = "/venue/textures/rosendal_park_sunset_1k.hdr";
/** Midday garden sky (Poly Haven "Pretoria Gardens", CC0, 1k). */
export const HDR_DAY_URL = "/venue/textures/pretoria_gardens_1k.hdr";

export type Tier = "high" | "medium" | "low";

/** Uniforms shared by every patched material; the stage updates them each frame. */
export type WorldUniforms = {
  uTime: { value: number };
  uNight: { value: number };
  uUpColor: { value: THREE.Color };
};

export function worldUniforms(): WorldUniforms {
  return {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uUpColor: { value: new THREE.Color("#ffb46a") },
  };
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------ shader patch */

type Patch = {
  /** Sway foliage above this height (m), in local space. */
  wind?: number;
  /** Ring/scar pattern along a palm trunk. */
  bark?: boolean;
  /** Patchy lawn and soil colour. */
  ground?: boolean;
  /** Warm uplight at night: strength and fall-off height (m). */
  uplight?: [number, number];
};

const NOISE = `
float vlHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vlNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
return mix(mix(vlHash(i),vlHash(i+vec2(1,0)),f.x),mix(vlHash(i+vec2(0,1)),vlHash(i+vec2(1,1)),f.x),f.y);}
`;

export function patchMaterial(mat: THREE.Material, u: WorldUniforms, p: Patch) {
  const key = JSON.stringify(p);
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.uniforms.uNight = u.uNight;
    sh.uniforms.uUpColor = u.uUpColor;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying vec3 vWPos;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
${
  p.wind !== undefined
    ? `{ float h = max(transformed.y - ${p.wind.toFixed(2)}, 0.0);
  vec4 o = modelMatrix * vec4(0.0,0.0,0.0,1.0);
  #ifdef USE_INSTANCING
  o = modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0);
  #endif
  float ph = o.x * 0.21 + o.z * 0.17 + transformed.x * 0.4 + transformed.z * 0.3;
  float k = h * h * 0.0035;
  transformed.x += (sin(uTime * 1.1 + ph) + 0.4 * sin(uTime * 2.7 + ph * 1.7)) * k;
  transformed.z += cos(uTime * 0.9 + ph * 1.3) * k * 0.7;
  transformed.y -= abs(sin(uTime * 1.6 + ph)) * k * 0.25; }`
    : ""
}`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
{ vec4 wpX = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  wpX = instanceMatrix * wpX;
  #endif
  vWPos = (modelMatrix * wpX).xyz; }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nuniform float uNight;\nuniform vec3 uUpColor;\nvarying vec3 vWPos;\n${NOISE}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
${
  p.bark
    ? `{ float ring = 0.5 + 0.5 * sin(vWPos.y * 15.0 + vlNoise(vWPos.xz * 3.0) * 4.0);
  float n = vlNoise(vec2(vWPos.y * 6.0, (vWPos.x + vWPos.z) * 4.0));
  diffuseColor.rgb *= mix(0.55, 1.18, ring * 0.7 + n * 0.3); }`
    : ""
}
${
  p.ground
    ? `{ float n = vlNoise(vWPos.xz * 0.11) * 0.6 + vlNoise(vWPos.xz * 0.53) * 0.3 + vlNoise(vWPos.xz * 2.1) * 0.1;
  diffuseColor.rgb *= mix(0.62, 1.32, n);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.1, 0.7), smoothstep(0.62, 0.8, n) * 0.6); }`
    : ""
}`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
${
  p.uplight
    ? `totalEmissiveRadiance += uUpColor * uNight * ${p.uplight[0].toFixed(3)} * exp(-max(vWPos.y + 0.6, 0.0) / ${p.uplight[1].toFixed(2)});`
    : ""
}`,
      );
  };
  mat.needsUpdate = true;
}

/* ------------------------------------------------------------ textures */

function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  draw(el.getContext("2d")!);
  return el;
}

/** One palm frond: rachis along x, leaflets angled toward the tip. Alpha cut-out. */
export function frondTexture() {
  const r = rng(5);
  const el = canvas(512, 128, (c) => {
    c.clearRect(0, 0, 512, 128);
    c.lineCap = "round";
    for (let i = 0; i < 70; i++) {
      const x = 14 + i * 7 + r() * 2;
      const t = x / 512;
      const len = (1 - Math.pow(t, 1.6)) * 52 + 6;
      for (const side of [-1, 1]) {
        const g = 70 + r() * 60;
        c.strokeStyle = `rgb(${40 + r() * 30},${g + 40},${30 + r() * 20})`;
        c.lineWidth = 2.6 - t * 1.2;
        c.beginPath();
        c.moveTo(x, 64);
        c.quadraticCurveTo(x + len * 0.25, 64 + side * len * 0.55, x + len * 0.55, 64 + side * len * 0.95);
        c.stroke();
      }
    }
    c.strokeStyle = "#6b6a3a";
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(0, 64);
    c.lineTo(500, 64);
    c.stroke();
  });
  const tex = new THREE.CanvasTexture(el);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Tileable ripple normal map for the lake. */
export function waterNormals() {
  const size = 256;
  const h = new Float32Array(size * size);
  const r = rng(9);
  const waves = Array.from({ length: 14 }, () => ({
    kx: Math.round((r() - 0.5) * 14),
    ky: Math.round((r() - 0.5) * 14),
    p: r() * 6.28,
    a: 0.3 + r(),
  }));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const w of waves) v += Math.sin(((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.p) * w.a;
      h[y * size + x] = v;
    }
  const el = canvas(size, size, (c) => {
    const img = c.createImageData(size, size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const dx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
        const dy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
        const n = new THREE.Vector3(-dx * 0.35, -dy * 0.35, 1).normalize();
        const i = (y * size + x) * 4;
        img.data[i] = (n.x * 0.5 + 0.5) * 255;
        img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
        img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    c.putImageData(img, 0, 0);
  });
  const tex = new THREE.CanvasTexture(el);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/* ------------------------------------------------------------ GLB shell */

export async function loadShell(onProgress?: (f: number) => void): Promise<THREE.Group> {
  const draco = new DRACOLoader().setDecoderPath("/venue/draco/").setWorkerLimit(2);
  try {
    const gltf = await new GLTFLoader()
      .setDRACOLoader(draco)
      .loadAsync(SHELL_URL, (e) => {
        if (e.lengthComputable && e.total) onProgress?.(e.loaded / e.total);
        else if (e.loaded) onProgress?.(Math.min(0.95, e.loaded / 3_900_000));
      });
    return gltf.scene;
  } finally {
    draco.dispose();
  }
}

export type ShellParts = {
  /** Trunk bases found in the exported palms, for the frond-card palms. */
  palms: { x: number; z: number; h: number }[];
  glass: THREE.MeshPhysicalMaterial[];
  roof: THREE.Object3D | null;
  water: THREE.MeshPhysicalMaterial | null;
  marble: THREE.MeshPhysicalMaterial | null;
};

/**
 * Replace the exported materials with tuned ones. The GLB colours were set
 * for Cycles; under real-time lighting they read too dark and too flat.
 */
export function upgradeShell(root: THREE.Object3D, u: WorldUniforms, tier: Tier): ShellParts {
  const parts: ShellParts = { palms: [], glass: [], roof: null, water: null, marble: null };
  const made = new Map<string, THREE.Material>();
  const remove: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name === "roof") parts.roof = o;
    if (!(o instanceof THREE.Mesh)) return;
    const old = o.material as THREE.MeshStandardMaterial;
    const name = old.name.replace(/\.\d+$/, "");
    // The exported lawn is a solid slab that covers the lake; buildBackdrop
    // replaces it with a lawn that has a hole for the water.
    // The garden module rebuilds these to the photos: frond-card palms on the
    // same trunk spots, curved stone terraces, potted agaves and the lake.
    if (name.startsWith("Date palm bark")) parts.palms = palmSpots(o.geometry);
    const replaced = [
      "Garden lawn",
      "Date palm bark",
      "Palm and fern foliage",
      "Dark planting soil",
      "Lake water",
      "Blue-green agave",
      "Warm limestone",
      "Hand-finished terracotta",
    ];
    if (o.name === "Cube" || name === "Material" || name.startsWith("Oak dance floor") || replaced.some((r) => name.startsWith(r))) {
      remove.push(o);
      return;
    }
    o.receiveShadow = true;
    o.castShadow = true;
    let m = made.get(name);
    if (!m) {
      m = makeShellMaterial(name, old, u, tier, parts);
      made.set(name, m);
    }
    if (m !== old) {
      old.dispose();
      o.material = m;
    }
    if (name.startsWith("Reflective smoked") || name.startsWith("Lake water")) o.castShadow = false;
    if (name.startsWith("Garden lawn") || name.startsWith("Dark planting soil") || name.startsWith("Polished grey marble"))
      o.castShadow = false;
    if (o.name.startsWith("Roof skin")) o.castShadow = true;
  });
  for (const o of remove) {
    o.removeFromParent();
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }
  return parts;
}

function makeShellMaterial(
  name: string,
  old: THREE.MeshStandardMaterial,
  u: WorldUniforms,
  tier: Tier,
  parts: ShellParts,
): THREE.Material {
  if (name.startsWith("Graphite powder-coated steel")) {
    const m = new THREE.MeshStandardMaterial({ name, color: "#1f2326", metalness: 0.72, roughness: 0.36 });
    patchMaterial(m, u, { uplight: [0.06, 2.2] });
    return m;
  }
  if (name.startsWith("Date palm bark")) {
    const m = new THREE.MeshStandardMaterial({ name, color: "#7a6248", roughness: 0.96 });
    patchMaterial(m, u, { bark: true, uplight: [0.32, 2.6] });
    return m;
  }
  if (name.startsWith("Polished grey marble")) {
    const map = old.map;
    if (map) {
      map.anisotropy = 8;
      map.colorSpace = THREE.SRGBColorSpace;
    }
    const m = new THREE.MeshPhysicalMaterial({
      name,
      map,
      // Light grey polished marble; on high tier the planar reflection adds
      // the mirror-sharp columns and garden seen in the photos.
      color: "#ebe7df",
      roughness: 0.36,
      metalness: 0,
      clearcoat: tier === "high" ? 0.3 : 0.55,
      clearcoatRoughness: tier === "high" ? 0.3 : 0.14,
      envMapIntensity: tier === "high" ? 0.5 : 1,
    });
    parts.marble = m;
    return m;
  }
  if (name.startsWith("Garden lawn")) {
    const m = new THREE.MeshStandardMaterial({ name, color: "#4c6a2c", roughness: 1 });
    patchMaterial(m, u, { ground: true });
    return m;
  }
  if (name.startsWith("Palm and fern foliage")) {
    const c = old.color.clone().multiplyScalar(1.9);
    c.offsetHSL(0.01, 0.05, 0);
    const m = new THREE.MeshStandardMaterial({
      name,
      color: c,
      roughness: 0.72,
      side: THREE.DoubleSide,
      emissive: c.clone().multiplyScalar(0.06),
    });
    patchMaterial(m, u, { wind: 2.5, uplight: [0.12, 3.5] });
    return m;
  }
  if (name.startsWith("Dark planting soil")) {
    const m = new THREE.MeshStandardMaterial({ name, color: "#3a2c1f", roughness: 1 });
    patchMaterial(m, u, { ground: true });
    return m;
  }
  if (name.startsWith("Lake water")) {
    const n = waterNormals();
    n.repeat.set(6, 2);
    const m = new THREE.MeshPhysicalMaterial({
      name,
      color: "#16372c",
      roughness: 0.03,
      metalness: 0,
      normalMap: n,
      normalScale: new THREE.Vector2(0.28, 0.28),
      envMapIntensity: 1.6,
      clearcoat: 0,
    });
    parts.water = m;
    return m;
  }
  if (name.startsWith("Blue-green agave")) {
    return new THREE.MeshStandardMaterial({ name, color: "#6f8f86", roughness: 0.6, side: THREE.DoubleSide });
  }
  if (name.startsWith("Reflective smoked clerestory glass")) {
    // The upper band reads as a mirror from outside and dark smoked glass from inside.
    const m = new THREE.MeshPhysicalMaterial({
      name,
      color: "#3c5258",
      metalness: 0.95,
      roughness: 0.04,
      envMapIntensity: 1.35,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      side: THREE.DoubleSide,
    });
    parts.glass.push(m);
    return m;
  }
  if (name.startsWith("Warm limestone")) {
    const m = new THREE.MeshStandardMaterial({ name, color: "#b5a389", roughness: 0.88 });
    patchMaterial(m, u, { ground: true, uplight: [0.1, 1.2] });
    return m;
  }
  if (name.startsWith("Hand-finished terracotta")) {
    return new THREE.MeshStandardMaterial({ name, color: "#a26d4b", roughness: 0.82 });
  }
  return old;
}

/* ------------------------------------------------------------ backdrop */

type PalmGeo = { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry };

/** A date palm: curved, tapered trunk and drooping frond cards. Local origin at the base. */
export function palmGeometry(seed: number, height: number): PalmGeo {
  const r = rng(seed);
  const lean = (r() - 0.5) * 1.6;
  const pts = [0, 0.3, 0.65, 1].map(
    (t) => new THREE.Vector3(lean * t * t + Math.sin(t * 3) * 0.12, t * height, Math.sin(t * 2.4) * lean * 0.3),
  );
  const curve = new THREE.CatmullRomCurve3(pts);
  const segs = 14,
    radial = 9;
  const trunk = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const p = trunk.attributes.position;
  const c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / (radial + 1));
    const t = ring / segs;
    curve.getPointAt(t, c);
    const rad = 0.42 - 0.12 * t + (t < 0.06 ? (0.06 - t) * 4 : 0);
    p.setXYZ(i, c.x + (p.getX(i) - c.x) * rad, c.y + (p.getY(i) - c.y) * rad, c.z + (p.getZ(i) - c.z) * rad);
  }
  trunk.computeVertexNormals();

  const top = curve.getPointAt(1);
  const fronds: THREE.BufferGeometry[] = [];
  const count = 26;
  for (let f = 0; f < count; f++) {
    const az = (f / count) * Math.PI * 2 + r() * 0.3;
    const ring = f % 3;
    const elev = [0.75, 0.25, -0.2][ring] + (r() - 0.5) * 0.25;
    const len = 3.1 + r() * 0.9 - ring * 0.1;
    const droop = 0.35 + ring * 0.25 + r() * 0.15;
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const steps = 7;
    const pos: number[] = [],
      uv: number[] = [],
      idx: number[] = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const d = len * t;
      const y = Math.sin(elev) * d - droop * d * d * 0.35;
      const centre = top.clone().addScaledVector(dir, Math.cos(elev) * d).setY(top.y + y);
      const w = 0.62 * Math.sin(Math.PI * (0.12 + 0.88 * t)) + 0.06;
      // Slight V fold: the leaflets lift above the rachis.
      for (const k of [-1, 1]) {
        const v = centre.clone().addScaledVector(side, k * w);
        v.y += w * 0.28;
        pos.push(v.x, v.y, v.z);
        uv.push(t, k < 0 ? 0 : 1);
      }
      if (s < steps) {
        const a = s * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    fronds.push(g);
  }
  const crown = mergeGeometries(fronds);
  fronds.forEach((g) => g.dispose());
  // Point normals up so the crown catches sky light like a canopy.
  const n = crown.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    const v = new THREE.Vector3(n.getX(i), Math.abs(n.getY(i)) + 0.8, n.getZ(i)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  return { trunk, crown };
}

export type Backdrop = {
  group: THREE.Group;
  hills: THREE.MeshBasicMaterial[];
  dispose: () => void;
};

/**
 * Everything beyond the Blender shell (it ends about 35 m out): ground,
 * date palms, a broadleaf tree belt and two hazy hill ridges.
 */
export function buildBackdrop(u: WorldUniforms, tier: Tier): Backdrop {
  const group = new THREE.Group();
  group.name = "backdrop";
  const r = rng(77);
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

  // Lawn at the shell's lawn level, with a hole for the lake (x +-30, z 24.3..37.6).
  const groundMat = keep(new THREE.MeshStandardMaterial({ color: "#5a6b40", roughness: 1 }));
  patchMaterial(groundMat, u, { ground: true });
  const outline = new THREE.Shape();
  outline.absarc(0, 0, 420, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  // Shape space is (x, -z) because the shape is turned flat with rotateX(-90deg).
  hole.moveTo(-30, -15.5);
  hole.lineTo(-30, -37.6);
  hole.lineTo(30, -37.6);
  hole.lineTo(30, -15.5);
  hole.lineTo(-30, -15.5);
  outline.holes.push(hole);
  const ground = new THREE.Mesh(keep(new THREE.ShapeGeometry(outline, 48).rotateX(-Math.PI / 2)), groundMat);
  ground.position.y = -0.42;
  ground.receiveShadow = true;
  group.add(ground);
  // Stone banks and a dark bed under the water.
  const stone = keep(new THREE.MeshStandardMaterial({ color: "#9f8f78", roughness: 0.9 }));
  patchMaterial(stone, u, { ground: true });
  const banks: THREE.BufferGeometry[] = [];
  for (const [x, z, w, d] of [
    [0, 37.85, 60.8, 0.5],
    [-30.2, 26.55, 0.4, 22.6],
    [30.2, 26.55, 0.4, 22.6],
  ] as const)
    banks.push(new THREE.BoxGeometry(w, 1.5, d).translate(x, -1.17, z));
  const bankMesh = new THREE.Mesh(keep(mergeGeometries(banks)), stone);
  banks.forEach((b) => b.dispose());
  bankMesh.receiveShadow = true;
  const bed = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(61, 23).rotateX(-Math.PI / 2)),
    keep(new THREE.MeshStandardMaterial({ color: "#0d1a14", roughness: 1 })),
  );
  bed.position.set(0, -1.9, 26.5);
  group.add(bankMesh, bed);

  // Date palms outside the shell's own planting.
  const palmCount = tier === "low" ? 24 : 46;
  const bark = keep(new THREE.MeshStandardMaterial({ color: "#7a6248", roughness: 0.96 }));
  patchMaterial(bark, u, { bark: true, uplight: [0.4, 3.0] });
  const frondMap = keep(frondTexture());
  const frond = keep(
    new THREE.MeshStandardMaterial({
      map: frondMap,
      color: "#c9dcae",
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.75,
    }),
  );
  patchMaterial(frond, u, { wind: 6, uplight: [0.08, 4] });
  const variants = [0, 1, 2].map((k) => palmGeometry(101 + k, 9 + k * 1.6));
  variants.forEach((v) => (keep(v.trunk), keep(v.crown)));
  const per: THREE.Matrix4[][] = [[], [], []];
  const q = new THREE.Quaternion(),
    s = new THREE.Vector3(),
    p = new THREE.Vector3();
  for (let i = 0, tries = 0; i < palmCount && tries < palmCount * 20; tries++) {
    const a = r() * Math.PI * 2;
    const d = 36 + Math.pow(r(), 0.8) * 46;
    const x = Math.cos(a) * d,
      z = Math.sin(a) * d;
    // The lake reaches z 37.6, inside this ring: keep trunk and fronds dry.
    if (!plantable(x, z, 3)) continue;
    i++;
    const sc = 0.85 + r() * 0.45;
    per[i % 3].push(
      new THREE.Matrix4().compose(
        p.set(x, -0.6, z),
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2),
        s.set(sc, sc * (0.9 + r() * 0.3), sc),
      ),
    );
  }
  variants.forEach((v, k) => {
    for (const [geo, mat] of [
      [v.trunk, bark],
      [v.crown, frond],
    ] as const) {
      const im = new THREE.InstancedMesh(geo, mat, per[k].length);
      per[k].forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = tier !== "low";
      im.frustumCulled = false;
      group.add(im);
    }
  });

  // Two ridges: near hills green-grey, far ones lost in the haze. Fog does the rest.
  const hills: THREE.MeshBasicMaterial[] = [];
  for (const [rad, base, amp, seed, color] of [
    [210, 10, 16, 3, "#56664c"],
    [320, 22, 30, 8, "#6f7b80"],
  ] as const) {
    const geo = keep(new THREE.CylinderGeometry(rad, rad, 1, 160, 1, true));
    const hp = geo.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      if (hp.getY(i) > 0) {
        const a = Math.atan2(hp.getZ(i), hp.getX(i));
        const y =
          base +
          amp *
            (0.5 +
              0.3 * Math.sin(a * 2 + seed) +
              0.15 * Math.sin(a * 5 + seed * 2) +
              0.08 * Math.sin(a * 13 + seed) +
              0.04 * Math.sin(a * 29));
        hp.setY(i, y);
      } else hp.setY(i, -2);
    }
    const mat = keep(new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: true }));
    hills.push(mat);
    group.add(new THREE.Mesh(geo, mat));
  }

  return {
    group,
    hills,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

/* ------------------------------------------------------------ floor reflection */

/**
 * Planar reflection for the polished marble. Drawn additively on top of the
 * lit floor, blurred a little and weighted by Fresnel, so the floor keeps its
 * own shading and shadows and gains the mirror-like sheen seen in the photos.
 */
export function floorReflector(size: number, w: number, h: number) {
  const shader = {
    name: "MarbleReflection",
    uniforms: {
      color: { value: null },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      uStrength: { value: 0.5 },
      uTexel: { value: new THREE.Vector2(1 / w, 1 / h) },
    },
    vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
void main(){ vUv = textureMatrix * vec4(position,1.0); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uStrength; uniform vec2 uTexel; varying vec4 vUv; varying vec3 vW;
float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){
  vec2 uv = vUv.xy / vUv.w;
  vec3 c = vec3(0.0);
  float b = 1.2;
  c += texture2D(tDiffuse, uv).rgb * 0.36;
  c += texture2D(tDiffuse, uv + vec2(uTexel.x * b, 0.0)).rgb * 0.16;
  c += texture2D(tDiffuse, uv - vec2(uTexel.x * b, 0.0)).rgb * 0.16;
  c += texture2D(tDiffuse, uv + vec2(0.0, uTexel.y * b * 1.8)).rgb * 0.16;
  c += texture2D(tDiffuse, uv - vec2(0.0, uTexel.y * b * 1.8)).rgb * 0.16;
  // Clamp the sun and sky so they do not flood the floor.
  c = min(c, vec3(2.2));
  vec3 v = normalize(cameraPosition - vW);
  float f = 0.035 + 0.965 * pow(1.0 - clamp(v.y, 0.0, 1.0), 5.0);
  // Slab joints every 1.2 x 0.6 m reflect less.
  vec2 g = abs(fract(vW.xz / vec2(1.2, 0.6)) - 0.5);
  float joint = smoothstep(0.495, 0.5, max(g.x * 1.0, g.y));
  float slab = 0.85 + 0.3 * h(floor(vW.xz / vec2(1.2, 0.6)));
  gl_FragColor = vec4(c * uStrength * mix(0.32, 1.0, f) * slab * (1.0 - joint * 0.5), 1.0);
}`,
  };
  const mirror = new Reflector(new THREE.PlaneGeometry(size, size), {
    textureWidth: w,
    textureHeight: h,
    clipBias: 0.002,
    multisample: 0,
    shader,
  });
  const m = mirror.material as THREE.ShaderMaterial;
  m.transparent = true;
  m.blending = THREE.AdditiveBlending;
  m.depthWrite = false;
  m.toneMapped = false;
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.y = 0.003;
  mirror.renderOrder = 1;
  return mirror;
}
