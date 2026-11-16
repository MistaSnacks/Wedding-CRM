import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { buildGarden, type Garden } from "./live-garden";
import type { Reflector } from "three/addons/objects/Reflector.js";
import type { LiveTable } from "./live-data";
import { clampPosition } from "./model";
import {
  HDR_URL,
  HDR_DAY_URL,
  buildBackdrop,
  floorReflector,
  loadShell,
  upgradeShell,
  worldUniforms,
  type Backdrop,
  type ShellParts,
  type Tier,
  type WorldUniforms,
} from "./live-world";

export type { Tier } from "./live-world";

/*
 * Live Three.js scene of the Benavento terrace (28 x 28 m, 8 m high, from the
 * venue's published page). The shell, palms and lake come from the
 * Blender-authored GLB (see live-world.ts); furniture comes from real seating
 * rows. Table moves made here stay in this browser (see VenueLive).
 */

export type ViewName = "overview" | "guest" | "garden" | "evening" | "plan";
export type PaletteId = "garden" | "terracotta" | "midnight";

export const PALETTES: Record<
  PaletteId,
  {
    label: string;
    linen: string;
    napkin: string;
    flowerA: string;
    flowerB: string;
    leaf: string;
    metal: string;
    cushion: string;
  }
> = {
  garden: {
    label: "Garden",
    linen: "#f2eee5",
    napkin: "#9fb08f",
    flowerA: "#f1c9c4",
    flowerB: "#fbf6ee",
    leaf: "#5f7448",
    metal: "#c8a56a",
    cushion: "#ece3d4",
  },
  terracotta: {
    label: "Terracotta",
    linen: "#e8d8c0",
    napkin: "#a9573a",
    flowerA: "#e8893a",
    flowerB: "#c24a35",
    leaf: "#55663a",
    metal: "#b47a48",
    cushion: "#d6bf9e",
  },
  midnight: {
    label: "Midnight",
    linen: "#283043",
    napkin: "#ece3d2",
    flowerA: "#fbf8f2",
    flowerB: "#e3d3ec",
    leaf: "#4c6049",
    metal: "#d6b46a",
    cushion: "#343c50",
  },
};

const TABLE_TOP = 0.76;
const ROOM_HALF = 14;

type Mats = {
  linen: THREE.MeshPhysicalMaterial;
  napkin: THREE.MeshStandardMaterial;
  flowerA: THREE.MeshPhysicalMaterial;
  flowerB: THREE.MeshPhysicalMaterial;
  leaf: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  cushion: THREE.MeshPhysicalMaterial;
  porcelain: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  wax: THREE.MeshStandardMaterial;
  flame: THREE.MeshStandardMaterial;
  hurricane: THREE.MeshStandardMaterial;
  bulb: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  parquet: THREE.MeshStandardMaterial;
  balustrade: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  water: THREE.MeshStandardMaterial;
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const ease = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/* ---------------------------------------------------------- geometry */

type Loop = { p: THREE.Vector2[]; n: THREE.Vector2[] };

/** Closed outline of a table top (x, z), with outward normals. */
function tableLoop(t: Pick<LiveTable, "shape" | "width" | "depth">, n = 160, grow = 0): Loop {
  const p: THREE.Vector2[] = [],
    nn: THREE.Vector2[] = [];
  if (t.shape === "round") {
    const r = t.width / 2 + grow;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      p.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
      nn.push(new THREE.Vector2(Math.cos(a), Math.sin(a)));
    }
    return { p, n: nn };
  }
  const cr = 0.06 + grow,
    hx = t.width / 2 - 0.06,
    hz = t.depth / 2 - 0.06;
  const lx = hx * 2,
    lz = hz * 2,
    arc = (Math.PI / 2) * cr;
  const per = 2 * lx + 2 * lz + 4 * arc;
  for (let i = 0; i <= n; i++) {
    let s = (i / n) * per;
    const seg = [lz, arc, lx, arc, lz, arc, lx, arc];
    let k = 0;
    while (k < 7 && s > seg[k]) s -= seg[k++];
    const corners = [
      [hx, hz],
      [-hx, hz],
      [-hx, -hz],
      [hx, -hz],
    ];
    let x = 0,
      z = 0,
      nx = 0,
      nz = 0;
    if (k % 2 === 0) {
      // straight edges: +x side going +z, +z side going -x, ...
      const side = k / 2;
      const f = s;
      if (side === 0) [x, z, nx, nz] = [hx + cr, -hz + f, 1, 0];
      if (side === 1) [x, z, nx, nz] = [hx - f, hz + cr, 0, 1];
      if (side === 2) [x, z, nx, nz] = [-hx - cr, hz - f, -1, 0];
      if (side === 3) [x, z, nx, nz] = [-hx + f, -hz - cr, 0, -1];
    } else {
      const c = corners[(k - 1) / 2];
      const a = ((k - 1) / 2) * (Math.PI / 2) + s / cr;
      nx = Math.cos(a);
      nz = Math.sin(a);
      x = c[0] + nx * cr;
      z = c[1] + nz * cr;
    }
    p.push(new THREE.Vector2(x, z));
    nn.push(new THREE.Vector2(nx, nz));
  }
  return { p, n: nn };
}

/** Draped linen: flat top plus a pleated skirt that flares to the floor. */
function linenGeometry(t: Pick<LiveTable, "shape" | "width" | "depth">) {
  const loop = tableLoop(t);
  const rows = 12,
    cols = loop.p.length;
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  let arc = 0;
  for (let i = 0; i < cols; i++) {
    if (i > 0) arc += loop.p[i].distanceTo(loop.p[i - 1]);
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      const lip = j === 0 ? 0.004 : 0.018;
      const pleat =
        Math.sin((arc / 0.21) * Math.PI * 2) * 0.026 * Math.pow(v, 1.3) +
        Math.sin((arc / 0.083) * Math.PI * 2 + 1.3) * 0.006 * v;
      const off = lip + 0.07 * Math.pow(v, 1.8) + pleat;
      const y = TABLE_TOP - (TABLE_TOP - 0.005) * v - (j === 0 ? 0 : 0.012);
      pos.push(loop.p[i].x + loop.n[i].x * off, y, loop.p[i].y + loop.n[i].y * off);
      uv.push(arc, v);
    }
  }
  for (let i = 0; i < cols - 1; i++)
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j,
        b = (i + 1) * (rows + 1) + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const skirt = new THREE.BufferGeometry();
  skirt.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  skirt.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  skirt.setIndex(idx);
  skirt.computeVertexNormals();
  const shape = new THREE.Shape(
    tableLoop(t, 96, 0.004).p.map((q) => new THREE.Vector2(q.x, -q.y)),
  );
  const top = new THREE.ShapeGeometry(shape, 4);
  top.rotateX(-Math.PI / 2);
  top.translate(0, TABLE_TOP, 0);
  const merged = mergeGeometries([skirt, top]);
  skirt.dispose();
  top.dispose();
  return merged;
}

function cyl(r1: number, r2: number, h: number, seg = 8) {
  return new THREE.CylinderGeometry(r1, r2, h, seg, 1);
}
function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) {
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/** Chiavari-style chair. Local front faces -z, the back is at +z. */
function chairGeometries() {
  const parts: THREE.BufferGeometry[] = [];
  const s = 0.2;
  for (const [x, z] of [
    [-s, -s],
    [s, -s],
  ])
    parts.push(place(cyl(0.013, 0.011, 0.46), x, 0.23, z));
  for (const x of [-s, s]) parts.push(place(cyl(0.014, 0.012, 0.95), x, 0.475, s, -0.06));
  for (let i = 0; i < 5; i++) {
    const x = -0.13 + i * 0.065;
    parts.push(place(cyl(0.007, 0.007, 0.3, 5), x, 0.73, s + 0.012, -0.06));
  }
  for (const y of [0.57, 0.9, 0.18])
    parts.push(place(cyl(0.011, 0.011, 0.42, 6), 0, y, s + (y - 0.475) * 0.06, 0, Math.PI / 2));
  parts.push(place(cyl(0.01, 0.01, 0.42, 6), 0, 0.18, -s, 0, Math.PI / 2));
  for (const x of [-s, s]) parts.push(place(cyl(0.01, 0.01, 0.42, 6), x, 0.43, 0, Math.PI / 2));
  for (const z of [-s, s]) parts.push(place(cyl(0.012, 0.012, 0.42, 6), 0, 0.43, z, 0, Math.PI / 2));
  const frame = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  const cushion = new RoundedBoxGeometry(0.42, 0.055, 0.42, 3, 0.022);
  cushion.translate(0, 0.475, 0);
  return { frame, cushion };
}

function lathe(points: [number, number][], seg = 24) {
  return new THREE.LatheGeometry(
    points.map(([r, h]) => new THREE.Vector2(r, h)),
    seg,
  );
}

function bloomGeometry() {
  const cup = lathe(
    [
      [0.001, 0],
      [0.028, 0.006],
      [0.046, 0.022],
      [0.054, 0.04],
      [0.05, 0.05],
      [0.036, 0.042],
      [0.03, 0.034],
      [0.022, 0.044],
      [0.001, 0.04],
    ],
    14,
  );
  return cup;
}

/* ---------------------------------------------------------- textures */

function canvasTexture(size: number, draw: (c: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d")!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function stoneTexture() {
  const r = rng(7);
  return canvasTexture(1024, (c) => {
    c.fillStyle = "#b9b1a3";
    c.fillRect(0, 0, 1024, 1024);
    // 1.2 x 0.6 m honed slabs; the texture covers 4.8 x 4.8 m.
    const w = 256,
      h = 128;
    for (let y = 0; y < 8; y++)
      for (let x = -1; x < 5; x++) {
        const ox = (y % 2) * (w / 2);
        const l = 180 + r() * 18;
        c.fillStyle = `rgb(${l},${l - 6 - r() * 4},${l - 16 - r() * 6})`;
        c.fillRect(x * w + ox + 2, y * h + 2, w - 4, h - 4);
      }
    for (let i = 0; i < 9000; i++) {
      c.fillStyle = `rgba(${r() > 0.5 ? "255,255,250" : "90,80,70"},${r() * 0.05})`;
      c.fillRect(r() * 1024, r() * 1024, 2 + r() * 3, 2 + r() * 3);
    }
  });
}

function parquetTexture() {
  const r = rng(11);
  return canvasTexture(512, (c) => {
    c.fillStyle = "#5a3a22";
    c.fillRect(0, 0, 512, 512);
    const pw = 32,
      pl = 160;
    for (let x = 0; x < 512 / pw; x++)
      for (let y = -1; y < 512 / pl + 1; y++) {
        const off = (x % 3) * 53;
        const l = 0.75 + r() * 0.3;
        c.fillStyle = `rgb(${150 * l},${100 * l},${62 * l})`;
        c.fillRect(x * pw + 1, y * pl + off + 1, pw - 2, pl - 2);
        for (let k = 0; k < 6; k++) {
          c.fillStyle = `rgba(60,35,20,${0.08 + r() * 0.08})`;
          c.fillRect(x * pw + 3 + r() * (pw - 6), y * pl + off, 1, pl);
        }
      }
  });
}

function glowTexture() {
  const t = canvasTexture(128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,190,120,1)");
    g.addColorStop(0.45, "rgba(255,160,90,0.35)");
    g.addColorStop(1, "rgba(255,140,80,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Dispose geometry, materials and textures under `root`, except `keep`. */
function disposeTree(root: THREE.Object3D, keep: Set<THREE.Material> = new Set()) {
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    for (const mm of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      if (keep.has(mm)) continue;
      for (const val of Object.values(mm)) if (val instanceof THREE.Texture) textures.add(val);
      mm.dispose();
    }
    if (o instanceof THREE.InstancedMesh) o.dispose();
  });
  textures.forEach((t) => t.dispose());
}

/* ---------------------------------------------------------- stage */

export type StageOptions = {
  reducedMotion: boolean;
  mobile: boolean;
  /** Force a quality tier (testing, or a user choice). Null lets the stage adapt. */
  tier?: Tier | null;
};
export type Projected = { id: string; x: number; y: number; visible: boolean };
export type LoadState = { progress: number; done: boolean; failed: boolean };
export type WalkInput = { f: number; s: number; t: number; fast: boolean };

type Pose = { p: [number, number, number]; t: [number, number, number]; fov: number };
/** Camera poses. The lake and the sunset are on the +z side, the entrance on -z. */
const POSES: Record<Exclude<ViewName, "plan">, Pose> = {
  overview: { p: [-15.5, 20, -23], t: [0, 0.4, 1.2], fov: 42 },
  // Seated at a table near the entrance, looking across the room to the lake.
  guest: { p: [-3.1, 1.22, -7.6], t: [0.6, 1.5, 4], fov: 60 },
  // On the far lake bank, looking back at the pavilion over the water.
  garden: { p: [8, 1.25, 40], t: [0.5, 3.8, 0], fov: 50 },
  evening: { p: [-8.2, 1.7, -10.4], t: [1.6, 2.4, 6], fov: 56 },
};
const FIRST_PERSON = new Set<ViewName>(["guest", "garden", "evening"]);
const Y = new THREE.Vector3(0, 1, 0);

export class VenueStage {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private sun = new THREE.DirectionalLight("#fff3e0", 3);
  private hemi = new THREE.HemisphereLight("#cfe0f0", "#5d5640", 0.8);
  private warmLights: THREE.PointLight[] = [];
  private sky: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private mats: Mats;
  private u: WorldUniforms = worldUniforms();
  private tier: Tier;
  private lockTier: boolean;
  private ratio: number;
  private maxRatio: number;
  private furniture = new THREE.Group();
  private hits = new THREE.Group();
  private rings = new THREE.Group();
  private dragGroup = new THREE.Group();
  /** Procedural stand-in shown until the Blender shell has loaded. */
  private fallback = new THREE.Group();
  private fallbackRoof = new THREE.Group();
  private festoon = new THREE.Group();
  private shell: THREE.Object3D | null = null;
  private parts: ShellParts | null = null;
  private backdrop: Backdrop;
  private reflector: Reflector | null = null;
  private flames: THREE.InstancedMesh | null = null;
  private tables: LiveTable[] = [];
  private time = 40;
  private view: ViewName = "overview";
  private roofOverride: boolean | null = null;
  private fly: {
    p0: THREE.Vector3;
    p1: THREE.Vector3;
    t0: THREE.Vector3;
    t1: THREE.Vector3;
    f0: number;
    f1: number;
    start: number;
    dur: number;
  } | null = null;
  private timeAnim: { from: number; to: number; start: number; dur: number } | null = null;
  private timer = new THREE.Timer();
  private raycaster = new THREE.Raycaster();
  private frameTimes: number[] = [];
  private envTexture: THREE.Texture;
  private hdrTexture: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator;
  private hdr: { day: THREE.Texture | null; sunset: THREE.Texture | null } = { day: null, sunset: null };
  private envScene = new THREE.Scene();
  private envMix: THREE.ShaderMaterial;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envBlend = -1;
  private garden: Garden | null = null;
  private gtao: GTAOPass | null = null;
  private grade: ShaderPass;
  private resize: ResizeObserver;
  private hovered: string | null = null;
  private selected: string | null = null;
  private lastStat = 0;
  private lastAdapt = 0;
  private disposed = false;
  private drag: { id: string; ox: number; oz: number; x: number; z: number; pointerId: number } | null = null;
  /** Arrange mode: pressing a table drags it instead of turning the camera. */
  arrange = false;
  walk: WalkInput = { f: 0, s: 0, t: 0, fast: false };
  onFrame: (() => void) | null = null;
  onTime: ((t: number) => void) | null = null;
  onLoad: ((s: LoadState) => void) | null = null;
  onSelectTable: ((id: string) => void) | null = null;
  onMoveTable: ((id: string, x: number, z: number) => void) | null = null;
  onWalk: (() => void) | null = null;

  constructor(
    private host: HTMLElement,
    private opts: StageOptions,
  ) {
    this.tier = opts.tier ?? (opts.mobile ? "medium" : "high");
    this.lockTier = Boolean(opts.tier);
    this.maxRatio = Math.min(window.devicePixelRatio, opts.mobile ? 2 : 1.5);
    this.ratio = this.tier === "low" ? Math.min(1, this.maxRatio) : this.maxRatio;
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer = r;
    r.setPixelRatio(this.ratio);
    r.setSize(host.clientWidth, host.clientHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = this.tier !== "low";
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = true;
    r.transmissionResolutionScale = 0.5;
    host.appendChild(r.domElement);
    r.domElement.style.display = "block";
    r.domElement.style.touchAction = "none";
    host.dataset.tier = this.tier;

    const pmrem = new THREE.PMREMGenerator(r);
    this.pmrem = pmrem;
    const room = new RoomEnvironment();
    this.envTexture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.3;
    // Reflections: two CC0 Poly Haven skies, a midday garden and a park at
    // sunset, blended along the time slider (see updateEnvironment).
    this.envMix = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { tDay: { value: null }, tSun: { value: null }, uMix: { value: 0 } },
      vertexShader: "varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform sampler2D tDay; uniform sampler2D tSun; uniform float uMix; varying vec3 vD;
void main(){ vec3 d = normalize(vD);
  vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  gl_FragColor = vec4(mix(texture2D(tDay, uv).rgb, texture2D(tSun, uv).rgb, uMix), 1.0); }`,
    });
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), this.envMix));
    const loadSky = (url: string, slot: "day" | "sunset") =>
      new HDRLoader()
        .setDataType(THREE.FloatType)
        .loadAsync(url)
        .then((hdr) => {
          if (this.disposed) {
            hdr.dispose();
            return;
          }
          // Clamp the sun: the env map is for sky and garden reflections. A
          // full-strength sun becomes a hot spot in the polished marble even
          // under the roof, where it could never be seen.
          const data = hdr.image.data as Float32Array;
          for (let i = 0; i < data.length; i += 4) {
            const m = Math.max(data[i], data[i + 1], data[i + 2]);
            if (m > 3) {
              const k = 3 / m;
              data[i] *= k;
              data[i + 1] *= k;
              data[i + 2] *= k;
            }
          }
          // Float textures are not linearly filterable everywhere; the
          // prefilter blurs anyway, so nearest sampling is enough.
          hdr.minFilter = hdr.magFilter = THREE.NearestFilter;
          hdr.generateMipmaps = false;
          hdr.needsUpdate = true;
          this.hdr[slot] = hdr;
          this.envBlend = -1;
          this.updateEnvironment();
          this.applyTime();
        })
        .catch(() => {
          /* The studio environment stays as a usable fallback. */
        });
    void loadSky(HDR_DAY_URL, "day");
    void loadSky(HDR_URL, "sunset");
    this.scene.fog = new THREE.FogExp2("#d9c9b0", 0.0045);

    this.camera = new THREE.PerspectiveCamera(42, host.clientWidth / host.clientHeight, 0.1, 900);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = !opts.reducedMotion;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.48;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 75;
    this.controls.addEventListener("start", () => {
      this.controls.autoRotate = false;
      this.fly = null;
      this.controls.enableDamping = !this.opts.reducedMotion;
    });

    const target = new THREE.WebGLRenderTarget(host.clientWidth, host.clientHeight, {
      type: THREE.HalfFloatType,
      samples: this.tier === "high" ? 4 : this.tier === "medium" ? 2 : 0,
    });
    this.composer = new EffectComposer(r, target);
    this.composer.setPixelRatio(r.getPixelRatio());
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(host.clientWidth, host.clientHeight), 0.12, 0.4, 0.92);
    if (this.tier === "high") {
      // Contact shadows under tables, chairs and planters: reads as a photo.
      this.gtao = new GTAOPass(this.scene, this.camera, host.clientWidth, host.clientHeight);
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
      this.gtao.blendIntensity = 0.85;
      this.composer.addPass(this.gtao);
    }
    this.bloom.enabled = this.tier !== "low";
    this.composer.addPass(this.bloom);
    // Gentle grade: less saturation and a touch of warmth, like the venue photos.
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uSat: { value: 0.86 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat; varying vec2 vUv;
void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  c.rgb = mix(vec3(l), c.rgb, uSat) * vec3(1.02, 1.0, 0.97); gl_FragColor = c; }`,
    });
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.mats = this.makeMaterials();
    this.sky = this.makeSky();
    this.stars = this.makeStars();
    this.buildLights();
    this.buildShell();
    this.backdrop = buildBackdrop(this.u, this.tier);
    this.scene.add(this.backdrop.group);
    if (this.tier === "high") this.addReflector();
    this.scene.add(this.furniture, this.hits, this.rings, this.dragGroup);

    const el = r.domElement;
    el.addEventListener("pointerdown", this.onDown, true);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);

    this.resize = new ResizeObserver(() => this.onResize());
    this.resize.observe(host);
    this.setView("overview", true);
    this.applyTime();
    r.setAnimationLoop(this.tick);
    void this.loadShell();
  }

  /* ----------------------------- Blender shell */

  private async loadShell() {
    try {
      const root = await loadShell((f) => this.onLoad?.({ progress: f, done: false, failed: false }));
      if (this.disposed) {
        disposeTree(root);
        return;
      }
      this.parts = upgradeShell(root, this.u, this.tier);
      this.shell = root;
      this.garden = buildGarden(this.u, this.tier, {
        palms: this.parts.palms,
        size: [this.host.clientWidth * this.ratio, this.host.clientHeight * this.ratio],
      });
      this.scene.add(this.garden.group);
      this.scene.remove(this.fallback);
      disposeTree(this.fallback, new Set(Object.values(this.mats)));
      this.scene.add(root);
      this.applyViewState();
      this.applyTime();
      this.onLoad?.({ progress: 1, done: true, failed: false });
    } catch {
      this.onLoad?.({ progress: 1, done: true, failed: true });
    }
  }

  private addReflector() {
    const w = Math.round(this.host.clientWidth * this.ratio * 0.5),
      h = Math.round(this.host.clientHeight * this.ratio * 0.5);
    this.reflector = floorReflector(28, Math.max(64, w), Math.max(64, h));
    this.scene.add(this.reflector);
  }

  private removeReflector() {
    if (!this.reflector) return;
    this.scene.remove(this.reflector);
    this.reflector.geometry.dispose();
    this.reflector.dispose();
    this.reflector = null;
    if (this.parts?.marble) {
      this.parts.marble.clearcoat = 0.45;
      this.parts.marble.envMapIntensity = 0.9;
    }
  }

  /* ----------------------------- materials */

  private makeMaterials(): Mats {
    const p = PALETTES.garden;
    const stoneMap = stoneTexture();
    stoneMap.repeat.set(28 / 4.8, 28 / 4.8);
    stoneMap.anisotropy = 8;
    const parquetMap = parquetTexture();
    parquetMap.repeat.set(4, 2);
    parquetMap.anisotropy = 8;
    return {
      linen: new THREE.MeshPhysicalMaterial({
        color: p.linen,
        roughness: 0.82,
        sheen: 0.6,
        sheenRoughness: 0.7,
        sheenColor: new THREE.Color("#ffffff"),
        side: THREE.DoubleSide,
      }),
      napkin: new THREE.MeshStandardMaterial({ color: p.napkin, roughness: 0.9 }),
      flowerA: new THREE.MeshPhysicalMaterial({
        color: p.flowerA,
        roughness: 0.6,
        sheen: 0.8,
        sheenColor: new THREE.Color("#ffffff"),
        side: THREE.DoubleSide,
      }),
      flowerB: new THREE.MeshPhysicalMaterial({
        color: p.flowerB,
        roughness: 0.6,
        sheen: 0.8,
        sheenColor: new THREE.Color("#ffffff"),
        side: THREE.DoubleSide,
      }),
      leaf: new THREE.MeshStandardMaterial({ color: p.leaf, roughness: 0.65, side: THREE.DoubleSide }),
      metal: new THREE.MeshStandardMaterial({ color: p.metal, metalness: 1, roughness: 0.32 }),
      cushion: new THREE.MeshPhysicalMaterial({
        color: p.cushion,
        roughness: 0.9,
        sheen: 0.5,
        sheenColor: new THREE.Color("#ffffff"),
      }),
      porcelain: new THREE.MeshStandardMaterial({ color: "#fbfaf6", roughness: 0.18 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: "#ffffff",
        roughness: 0.04,
        transmission: 1,
        thickness: 0.01,
        ior: 1.5,
        side: THREE.DoubleSide,
      }),
      wax: new THREE.MeshStandardMaterial({
        color: "#f6efe1",
        roughness: 0.55,
        emissive: "#ffb46b",
        emissiveIntensity: 0,
      }),
      flame: new THREE.MeshStandardMaterial({
        color: "#000000",
        emissive: "#ffb35c",
        emissiveIntensity: 3,
      }),
      hurricane: new THREE.MeshStandardMaterial({
        color: "#eef6f4",
        roughness: 0.05,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      }),
      bulb: new THREE.MeshStandardMaterial({
        color: "#fff0d8",
        emissive: "#ffc27a",
        emissiveIntensity: 0.4,
      }),
      steel: new THREE.MeshStandardMaterial({ color: "#2c2a27", metalness: 0.6, roughness: 0.45 }),
      stone: new THREE.MeshStandardMaterial({ map: stoneMap, roughness: 0.62 }),
      parquet: new THREE.MeshStandardMaterial({ map: parquetMap, roughness: 0.5 }),
      balustrade: new THREE.MeshStandardMaterial({
        color: "#d8ebef",
        roughness: 0.04,
        metalness: 0.1,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
      glow: new THREE.MeshBasicMaterial({
        map: glowTexture(),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
      water: new THREE.MeshStandardMaterial({ color: "#35596a", roughness: 0.12, metalness: 0.4 }),
    };
  }

  setPalette(id: PaletteId) {
    const p = PALETTES[id];
    const m = this.mats;
    m.linen.color.set(p.linen);
    m.napkin.color.set(p.napkin);
    m.flowerA.color.set(p.flowerA);
    m.flowerB.color.set(p.flowerB);
    m.leaf.color.set(p.leaf);
    m.metal.color.set(p.metal);
    m.cushion.color.set(p.cushion);
  }

  /* ----------------------------- sky, lights, shell */

  private makeSky() {
    const sky = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color("#6f9cc4") },
        bottom: { value: new THREE.Color("#e8dccb") },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color("#ffd2a0") },
        glow: { value: 0.4 },
      },
      vertexShader:
        "varying vec3 vDir;void main(){vDir=normalize(position);vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_Position=p.xyww;}",
      fragmentShader: `uniform vec3 top;uniform vec3 bottom;uniform vec3 sunDir;uniform vec3 sunColor;uniform float glow;varying vec3 vDir;
void main(){vec3 d=normalize(vDir);float h=smoothstep(-0.04,0.6,d.y);vec3 c=mix(bottom,top,pow(h,0.8));
float s=max(dot(d,normalize(sunDir)),0.0);float band=exp(-abs(d.y)*9.0);
c+=sunColor*(pow(s,6.0)*0.55*glow+pow(s,90.0)*1.2*glow+band*pow(s,2.0)*0.35*glow);
c+=sunColor*smoothstep(0.9993,0.9997,s)*4.0*glow;
gl_FragColor=vec4(c,1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), sky);
    dome.frustumCulled = false;
    dome.renderOrder = -1;
    this.scene.add(dome);
    return sky;
  }

  private makeStars() {
    const r = rng(3);
    const pos: number[] = [];
    for (let i = 0; i < 700; i++) {
      const a = r() * Math.PI * 2,
        y = 0.08 + r() * 0.92,
        rad = 380;
      const s = Math.sqrt(1 - y * y);
      pos.push(Math.cos(a) * s * rad, y * rad, Math.sin(a) * s * rad);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        color: "#e8ecff",
        size: 1.4,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      }),
    );
    this.scene.add(stars);
    return stars;
  }

  private buildLights() {
    const s = this.sun;
    s.castShadow = true;
    const size = this.tier === "high" ? 4096 : 2048;
    s.shadow.mapSize.set(size, size);
    const c = s.shadow.camera;
    // Covers the terrace and the palms that shade it.
    c.left = c.bottom = -30;
    c.right = c.top = 30;
    c.near = 1;
    c.far = 140;
    s.shadow.bias = -0.0004;
    s.shadow.radius = 6;
    s.shadow.blurSamples = 12;
    s.shadow.normalBias = 0.025;
    this.scene.add(s, s.target, this.hemi);
    for (const [x, z] of [
      [-7, -7],
      [7, -7],
      [-7, 7],
      [7, 7],
    ]) {
      const l = new THREE.PointLight("#ffb978", 0, 20, 1.6);
      l.position.set(x, 5.6, z);
      this.warmLights.push(l);
      this.scene.add(l);
    }
  }

  private buildShell() {
    const m = this.mats;
    // Raised terrace platform and stone floor, 28 x 28 m inside.
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(30, 0.6, 30),
      new THREE.MeshStandardMaterial({ color: "#a39a8b", roughness: 0.85 }),
    );
    platform.position.y = -0.302;
    platform.receiveShadow = true;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(28, 28).rotateX(-Math.PI / 2), m.stone);
    floor.receiveShadow = true;
    const dance = new THREE.Mesh(new THREE.PlaneGeometry(9, 4).rotateX(-Math.PI / 2), m.parquet);
    dance.position.y = 0.012;
    dance.receiveShadow = true;
    // The parquet stays after the Blender shell loads; the rest is a stand-in.
    this.scene.add(dance);
    this.fallback.add(platform, floor);

    // Steel frame: columns every 7 m, ring beams and simple trusses.
    // Roof panels are left off so the room can be seen from above.
    const steel: THREE.BufferGeometry[] = [];
    const brass: THREE.BufferGeometry[] = [];
    for (const x of [-9 / 2, 9 / 2]) brass.push(place(new THREE.BoxGeometry(0.04, 0.02, 4.04), x, 0.02, 0));
    for (const z of [-2, 2]) brass.push(place(new THREE.BoxGeometry(9.04, 0.02, 0.04), 0, 0.02, z));
    for (let i = 0; i <= 4; i++)
      for (let j = 0; j <= 4; j++) {
        if (i > 0 && i < 4 && j > 0 && j < 4) continue;
        steel.push(place(new THREE.BoxGeometry(0.3, 8, 0.3), -14 + i * 7, 4, -14 + j * 7));
      }
    const roof: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      roof.push(place(new THREE.BoxGeometry(28.3, 0.45, 0.3), 0, 8, s * 14));
      roof.push(place(new THREE.BoxGeometry(0.3, 0.45, 28.3), s * 14, 8, 0));
    }
    for (let k = 1; k < 4; k++) {
      const z = -14 + k * 7;
      roof.push(place(new THREE.BoxGeometry(28, 0.16, 0.16), 0, 8.05, z));
      roof.push(place(new THREE.BoxGeometry(28, 0.12, 0.12), 0, 7.3, z));
      for (let i = 0; i <= 14; i++) {
        const x = -14 + i * 2;
        roof.push(place(new THREE.BoxGeometry(0.06, 0.75, 0.06), x, 7.68, z));
        if (i < 14) {
          const d = new THREE.BoxGeometry(0.05, Math.hypot(2, 0.75), 0.05);
          d.rotateZ(Math.atan2(2, 0.75) * (i % 2 ? 1 : -1));
          roof.push(place(d, x + 1, 7.68, z));
        }
      }
    }
    // Glass balustrade, open at the south entrance.
    const glass: THREE.BufferGeometry[] = [];
    for (const [x, z, w, rot] of [
      [0, -14, 28, 0],
      [-14, 0, 28, Math.PI / 2],
      [14, 0, 28, Math.PI / 2],
      [-8.5, 14, 11, 0],
      [8.5, 14, 11, 0],
    ] as const) {
      const g = new THREE.BoxGeometry(w, 1.05, 0.02);
      g.rotateY(rot);
      glass.push(place(g, x, 0.53, z));
      const rail = new THREE.BoxGeometry(w, 0.05, 0.06);
      rail.rotateY(rot);
      steel.push(place(rail, x, 1.08, z));
    }
    const roofMesh = new THREE.Mesh(mergeGeometries(roof), m.steel);
    roofMesh.castShadow = true;
    this.fallbackRoof.add(roofMesh);
    roof.forEach((g) => g.dispose());
    this.fallback.add(this.fallbackRoof);
    this.scene.add(this.fallback, this.festoon);
    const steelMesh = new THREE.Mesh(mergeGeometries(steel), m.steel);
    steelMesh.castShadow = true;
    steelMesh.receiveShadow = true;
    const glassMesh = new THREE.Mesh(mergeGeometries(glass), m.balustrade);
    const brassMesh = new THREE.Mesh(mergeGeometries(brass), m.metal);
    this.fallback.add(steelMesh, glassMesh);
    this.scene.add(brassMesh);
    [...steel, ...glass, ...brass].forEach((g) => g.dispose());

    // Festoon lights between the trusses.
    const bulbs: THREE.Vector3[] = [];
    const wire: number[] = [];
    for (let k = 0; k < 4; k++) {
      const z = -10.5 + k * 7;
      let prev: THREE.Vector3 | null = null;
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        const x = -14 + u * 28;
        const y = 7.1 - Math.sin(u * Math.PI * 3) ** 2 * 0.9;
        const p = new THREE.Vector3(x, y, z + Math.sin(u * 9) * 0.15);
        if (i % 2 === 0) bulbs.push(p.clone().setY(y - 0.08));
        if (prev) wire.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
    }
    const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 10, 8), m.bulb, bulbs.length);
    const mx = new THREE.Matrix4();
    bulbs.forEach((b, i) => bulbMesh.setMatrixAt(i, mx.makeTranslation(b.x, b.y, b.z)));
    bulbMesh.frustumCulled = false;
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute("position", new THREE.Float32BufferAttribute(wire, 3));
    this.festoon.add(bulbMesh, new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: "#1d1b18" })));

  }

  /* ----------------------------- furniture */

  setTables(tables: LiveTable[]) {
    this.tables = tables;
    this.buildFurniture(tables, this.furniture, this.hits);
    this.updateRings();
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Build linens, chairs and settings for `tables` into `group` (instanced per material). */
  private buildFurniture(tables: LiveTable[], group: THREE.Group, hits: THREE.Group | null) {
    this.clearGroup(group, true);
    if (hits) this.clearGroup(hits, false);
    const m = this.mats;
    const linens: THREE.BufferGeometry[] = [];
    const glowGeos: THREE.BufferGeometry[] = [];
    const cache = new Map<string, THREE.BufferGeometry>();
    type Inst = THREE.Matrix4[];
    const chairs: Inst = [],
      chargers: Inst = [],
      plates: Inst = [],
      napkins: Inst = [],
      glasses: Inst = [],
      bowls: Inst = [],
      bloomsA: Inst = [],
      bloomsB: Inst = [],
      leaves: Inst = [],
      petals: Inst = [],
      candles: Inst = [],
      flames: Inst = [],
      hurricanes: Inst = [];
    const q = new THREE.Quaternion(),
      e = new THREE.Euler(),
      v = new THREE.Vector3(),
      s = new THREE.Vector3();
    const mat = (x: number, y: number, z: number, ry: number, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) =>
      new THREE.Matrix4().compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz, "YXZ")), s.set(sx, sy, sz));

    for (const t of tables) {
      const rot = (t.rotation * Math.PI) / 180;
      const cos = Math.cos(rot),
        sin = Math.sin(rot);
      const world = (lx: number, lz: number): [number, number] => [
        t.x + lx * cos + lz * sin,
        t.z - lx * sin + lz * cos,
      ];
      const key = `${t.shape}:${t.width}:${t.depth}`;
      if (!cache.has(key)) cache.set(key, linenGeometry(t));
      const lg = cache.get(key)!.clone();
      lg.rotateY(rot);
      lg.translate(t.x, 0, t.z);
      linens.push(lg);
      const glowSize = t.shape === "round" ? t.width * 1.5 : t.width * 1.2;
      const gg = new THREE.PlaneGeometry(glowSize, t.shape === "round" ? glowSize : t.depth * 2.4).rotateX(-Math.PI / 2);
      gg.rotateY(rot);
      gg.translate(t.x, TABLE_TOP + 0.004, t.z);
      glowGeos.push(gg);

      // Seats: local position (lx, lz) and outward direction.
      const seats: { lx: number; lz: number; dx: number; dz: number }[] = [];
      if (t.shape === "round") {
        for (let i = 0; i < t.capacity; i++) {
          const a = (i / t.capacity) * Math.PI * 2 + Math.PI / 2;
          seats.push({ lx: Math.cos(a), lz: Math.sin(a), dx: Math.cos(a), dz: Math.sin(a) });
        }
      } else {
        const per = Math.ceil(t.capacity / 2);
        for (let i = 0; i < t.capacity; i++) {
          const side = i < per ? 1 : -1;
          const k = i < per ? i : i - per;
          const n = i < per ? per : t.capacity - per;
          const lx = -t.width / 2 + (t.width / n) * (k + 0.5);
          seats.push({ lx, lz: side, dx: 0, dz: side });
        }
      }
      const r = t.width / 2;
      for (const st of seats) {
        const [dxw, dzw] = [st.dx * cos + st.dz * sin, -st.dx * sin + st.dz * cos];
        const ry = Math.atan2(dxw, dzw);
        const edge = t.shape === "round" ? r : t.depth / 2;
        const base =
          t.shape === "round"
            ? world(st.lx * r, st.lz * r)
            : world(st.lx, st.lz * edge);
        const chairOff = 0.5;
        chairs.push(mat(base[0] + dxw * chairOff, 0, base[1] + dzw * chairOff, ry));
        const px = base[0] - dxw * 0.25,
          pz = base[1] - dzw * 0.25;
        chargers.push(mat(px, TABLE_TOP + 0.006, pz, ry));
        plates.push(mat(px, TABLE_TOP + 0.011, pz, ry));
        napkins.push(mat(px, TABLE_TOP + 0.03, pz, ry + 0.25, 1, 1, 1, 0, 0.0));
        // Right-hand side of the guest, a little toward the centre.
        const rx = -dzw,
          rz = dxw;
        glasses.push(mat(px - dxw * 0.2 - rx * 0.14, TABLE_TOP, pz - dzw * 0.2 - rz * 0.14, 0));
      }

      // Centerpieces: one per round table, a row along long tables.
      const seed = Array.from(t.id).reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
      const rand = rng(seed);
      const clusters: [number, number, number][] =
        t.shape === "round"
          ? [[0, 0, 1]]
          : Array.from({ length: Math.max(1, Math.round(t.width / 1.1)) }, (_, i) => {
              const count = Math.max(1, Math.round(t.width / 1.1));
              return [-t.width / 2 + (t.width / count) * (i + 0.5), 0, 0.7] as [number, number, number];
            });
      for (const [lx, lz, size] of clusters) {
        const [cx, cz] = world(lx, lz);
        bowls.push(mat(cx, TABLE_TOP, cz, 0, size, size, size));
        const n = Math.round(26 * size);
        for (let i = 0; i < n; i++) {
          const f = (i + 0.5) / n;
          const polar = Math.acos(1 - f) * 0.95;
          const az = i * 2.39996 + rand() * 0.3;
          const rad = 0.2 * size;
          const nx = Math.sin(polar) * Math.cos(az),
            ny = Math.cos(polar),
            nz = Math.sin(polar) * Math.sin(az);
          const sc = (0.85 + rand() * 0.5) * size;
          const mtx = new THREE.Matrix4().compose(
            v.set(cx + nx * rad, TABLE_TOP + 0.1 * size + ny * rad * 0.62, cz + nz * rad),
            q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, ny, nz).normalize()),
            s.set(sc, sc, sc),
          );
          (rand() < 0.55 ? bloomsA : bloomsB).push(mtx);
        }
        for (let i = 0; i < 14 * size; i++) {
          const az = (i / (14 * size)) * Math.PI * 2 + rand() * 0.4;
          leaves.push(
            mat(
              cx + Math.cos(az) * 0.2 * size,
              TABLE_TOP + 0.09,
              cz + Math.sin(az) * 0.2 * size,
              -az + Math.PI / 2,
              size,
              size,
              size,
              1.15 + rand() * 0.3,
            ),
          );
        }
        // Candles in hurricane glasses around the flowers.
        const cn = t.shape === "round" ? 3 : 2;
        for (let i = 0; i < cn; i++) {
          const az = (i / cn) * Math.PI * 2 + 0.5 + rand();
          const d = t.shape === "round" ? 0.42 : 0.38;
          const [hx, hz] =
            t.shape === "round"
              ? [cx + Math.cos(az) * d, cz + Math.sin(az) * d]
              : world(lx + (i ? d : -d), lz);
          const h = 0.1 + rand() * 0.08;
          candles.push(mat(hx, TABLE_TOP + h / 2, hz, 0, 1, h / 0.1, 1));
          flames.push(mat(hx, TABLE_TOP + h + 0.025, hz, 0));
          hurricanes.push(mat(hx, TABLE_TOP + 0.13, hz, 0));
        }
      }
      for (let i = 0; i < 10; i++) {
        const a = rand() * Math.PI * 2;
        const d =
          t.shape === "round" ? 0.3 + rand() * (r - 0.6) : rand() * (t.width / 2 - 0.2);
        const [x, z] =
          t.shape === "round"
            ? [t.x + Math.cos(a) * d, t.z + Math.sin(a) * d]
            : world((rand() < 0.5 ? -1 : 1) * d, (rand() - 0.5) * 0.2);
        petals.push(mat(x, TABLE_TOP + 0.004, z, a, 1, 1, 1, 0.08 * (rand() - 0.5)));
      }

      const hit =
        t.shape === "round"
          ? new THREE.Mesh(new THREE.CylinderGeometry(r + 0.7, r + 0.7, 1.4, 16), new THREE.MeshBasicMaterial({ visible: false }))
          : new THREE.Mesh(new THREE.BoxGeometry(t.width + 1.2, 1.4, t.depth + 1.6), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(t.x, 0.7, t.z);
      hit.rotation.y = rot;
      hit.userData.id = t.id;
      if (hits) hits.add(hit);
      else {
        hit.geometry.dispose();
        (hit.material as THREE.Material).dispose();
      }
    }
    cache.forEach((g) => g.dispose());

    if (linens.length) {
      const linenMesh = new THREE.Mesh(mergeGeometries(linens), m.linen);
      linenMesh.castShadow = linenMesh.receiveShadow = true;
      linens.forEach((g) => g.dispose());
      const glowMesh = new THREE.Mesh(mergeGeometries(glowGeos), m.glow);
      glowMesh.renderOrder = 2;
      group.add(linenMesh, glowMesh);
      glowGeos.forEach((g) => g.dispose());
    }

    const add = (geo: THREE.BufferGeometry, material: THREE.Material, list: Inst, shadow = true) => {
      if (!list.length) {
        geo.dispose();
        return null;
      }
      const im = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.castShadow = shadow;
      im.receiveShadow = shadow;
      im.frustumCulled = false;
      group.add(im);
      return im;
    };
    const chair = chairGeometries();
    add(chair.frame, m.metal, chairs);
    add(chair.cushion, m.cushion, chairs);
    add(cyl(0.16, 0.16, 0.008, 32), m.metal, chargers, false);
    add(
      lathe([
        [0, 0],
        [0.09, 0],
        [0.12, 0.008],
        [0.135, 0.016],
        [0.13, 0.018],
        [0.1, 0.01],
        [0, 0.008],
      ], 32),
      m.porcelain,
      plates,
      false,
    );
    const napkin = new RoundedBoxGeometry(0.17, 0.02, 0.1, 2, 0.008);
    add(napkin, m.napkin, napkins, false);
    const wine = lathe(
      [
        [0, 0],
        [0.035, 0],
        [0.036, 0.004],
        [0.006, 0.008],
        [0.004, 0.1],
        [0.02, 0.112],
        [0.038, 0.15],
        [0.04, 0.19],
        [0.036, 0.215],
        [0.034, 0.214],
        [0.037, 0.19],
        [0.035, 0.15],
        [0.018, 0.116],
        [0, 0.112],
      ],
      18,
    );
    add(wine, m.glass, glasses, false);
    add(
      lathe([
        [0.05, 0],
        [0.07, 0.02],
        [0.13, 0.06],
        [0.16, 0.085],
        [0.15, 0.09],
        [0, 0.07],
      ], 28),
      m.metal,
      bowls,
    );
    add(bloomGeometry(), m.flowerA, bloomsA);
    add(bloomGeometry(), m.flowerB, bloomsB);
    const leaf = new THREE.ConeGeometry(0.035, 0.2, 4, 1);
    leaf.scale(1, 1, 0.25);
    leaf.translate(0, 0.1, 0);
    add(leaf, m.leaf, leaves);
    add(new THREE.CircleGeometry(0.018, 6).rotateX(-Math.PI / 2).scale(1, 1, 0.6), m.flowerA, petals, false);
    add(cyl(0.028, 0.028, 0.1, 14).translate(0, 0, 0), m.wax, candles, false);
    const flame = new THREE.SphereGeometry(0.012, 8, 6);
    flame.scale(1, 2.2, 1);
    const fl = add(flame, m.flame, flames, false);
    if (group === this.furniture) this.flames = fl;
    const hurricane = new THREE.CylinderGeometry(0.06, 0.055, 0.26, 20, 1, true);
    add(hurricane, m.hurricane, hurricanes, false);

  }

  private clearGroup(g: THREE.Group, disposeMaterials: boolean) {
    for (const o of [...g.children]) {
      g.remove(o);
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (!disposeMaterials && !Array.isArray(o.material)) o.material.dispose();
      }
      if (o instanceof THREE.InstancedMesh) o.dispose();
    }
  }

  private updateRings() {
    this.clearGroup(this.rings, false);
    for (const [id, color, opacity] of [
      [this.hovered, "#ffe0a8", 0.55],
      [this.selected, "#ffcf7a", 0.95],
    ] as const) {
      const t = this.tables.find((x) => x.id === id);
      if (!t) continue;
      const inner = tableLoop(t, 96, 0.95).p,
        outer = tableLoop(t, 96, 1.08).p;
      const pos: number[] = [],
        idx: number[] = [];
      for (let i = 0; i < inner.length; i++) {
        pos.push(inner[i].x, 0, inner[i].y, outer[i].x, 0, outer[i].y);
        if (i < inner.length - 1) {
          const a = i * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      const ring = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      const at = this.posOf(t);
      ring.position.set(at.x, 0.03, at.z);
      ring.rotation.y = (t.rotation * Math.PI) / 180;
      this.rings.add(ring);
    }
  }

  setHighlight(hovered: string | null, selected: string | null) {
    if (hovered === this.hovered && selected === this.selected) return;
    this.hovered = hovered;
    this.selected = selected;
    this.updateRings();
  }

  /* ----------------------------- time of day */

  setTime(t: number, animate = false) {
    if (animate && !this.opts.reducedMotion) {
      this.timeAnim = { from: this.time, to: t, start: performance.now(), dur: 1600 };
      return;
    }
    this.timeAnim = null;
    this.time = t;
    this.applyTime();
  }

  private applyTime() {
    const k = this.time / 100;
    const elev = 52 - 72 * k; // degrees: afternoon -> below the horizon
    // Guadalajara sets the sun in the west; here the west is the lake side (+z).
    const az = THREE.MathUtils.degToRad(24);
    const er = THREE.MathUtils.degToRad(elev);
    const sunDir = new THREE.Vector3(Math.cos(er) * Math.sin(az), Math.sin(er), Math.cos(er) * Math.cos(az));
    const day = smooth(-5, 10, elev);
    const golden = (1 - smooth(3, 28, elev)) * day;
    const night = 1 - smooth(-9, 2, elev);
    // Lights come on after sunset, not during it.
    const warm = smooth(0.6, 0.86, k);
    this.updateEnvironment();

    const col = new THREE.Color("#fff4e4").lerp(new THREE.Color("#ff9142"), golden);
    const moonDir = new THREE.Vector3(-0.35, 0.8, -0.45).normalize();
    const lightDir = night > 0.5 ? moonDir : sunDir.clone().setY(Math.max(0.06, sunDir.y));
    this.sun.position.copy(lightDir).multiplyScalar(60);
    this.sun.color.copy(night > 0.5 ? new THREE.Color("#8ea6d8") : col);
    this.sun.intensity = night > 0.5 ? 0.3 * night : 3.1 * day * (1 - 0.3 * golden) + 0.15;

    this.hemi.color.set("#d3e3f2").lerp(new THREE.Color("#ffc59a"), golden).lerp(new THREE.Color("#2c3a5c"), night);
    this.hemi.groundColor.set("#6b6046").lerp(new THREE.Color("#141418"), night);
    this.hemi.intensity = 0.1 + 0.55 * day + 0.3 * golden;
    this.scene.environmentIntensity = this.hdrTexture ? 0.07 + 0.75 * day : 0.08 + 0.22 * day;

    const top = new THREE.Color("#4a86c4").lerp(new THREE.Color("#46578f"), golden).lerp(new THREE.Color("#050b1f"), night);
    const bottom = new THREE.Color("#d2dfe6")
      .lerp(new THREE.Color("#ffa266"), golden)
      .lerp(new THREE.Color("#3a2d4a"), smooth(0, 0.5, night))
      .lerp(new THREE.Color("#121a34"), smooth(0.5, 1, night));
    const u = this.sky.uniforms;
    u.top.value.copy(top);
    u.bottom.value.copy(bottom);
    u.sunDir.value.copy(sunDir);
    u.sunColor.value.set("#ffd6a3").lerp(new THREE.Color("#ff7a38"), golden);
    u.glow.value = (0.25 + 1.1 * golden + 0.3 * (1 - day)) * (1 - night);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(bottom).lerp(top, 0.18);
    fog.density = (0.0042 + night * 0.0016) * (this.view === "plan" ? 0.35 : 1);
    (this.stars.material as THREE.PointsMaterial).opacity = smooth(0.72, 0.98, k);
    this.mats.water.color.copy(top).lerp(bottom, 0.4).multiplyScalar(0.55);

    // Hills: green-grey by day, warm haze at sunset, a dark silhouette at night.
    const light = 0.12 + 0.88 * day;
    const [near, far] = this.backdrop.hills;
    near.color.set("#566a4b").lerp(new THREE.Color("#7a6a5c"), golden * 0.6).multiplyScalar(light);
    far.color.set("#7d8c96").lerp(bottom, 0.45).lerp(new THREE.Color("#7a6670"), golden * 0.5).multiplyScalar(0.25 + 0.75 * light);

    this.u.uNight.value = warm;
    this.mats.flame.emissiveIntensity = 1.5 + 5 * warm;
    this.mats.wax.emissiveIntensity = 0.25 * warm;
    this.mats.bulb.emissiveIntensity = 0.15 + 7 * warm;
    this.mats.glow.opacity = 0.05 + 0.45 * warm;
    this.warmLights.forEach((l) => (l.intensity = 9 * warm));
    this.bloom.strength = 0.1 + 0.32 * warm;
    if (this.reflector) (this.reflector.material as THREE.ShaderMaterial).uniforms.uStrength.value = (0.7 + 0.2 * warm) * (this.roofShown() ? 1 : 0.35 + 0.5 * warm);
    if (this.parts?.water) this.parts.water.color.set("#16372c").multiplyScalar(0.4 + 0.6 * day);
    this.renderer.toneMappingExposure = 1.0 + 0.18 * golden + 0.12 * night;
    if (this.garden) {
      this.garden.fire.light.intensity = 4 + 40 * warm;
      this.garden.fire.flame.opacity = 0.45 + 0.5 * warm;
      const lu = (this.garden.lakeMirror?.material as THREE.ShaderMaterial | undefined)?.uniforms;
      if (lu) lu.uLight.value = 0.25 + 0.75 * day;
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Re-prefilter the blended day/sunset sky when the blend moves enough. */
  private updateEnvironment() {
    const { day, sunset } = this.hdr;
    if (!day && !sunset) return;
    const blend = !day ? 1 : !sunset ? 0 : smooth(0.3, 0.62, this.time / 100);
    if (this.envBlend >= 0 && Math.abs(blend - this.envBlend) < 0.08 && !(blend === 0 || blend === 1)) return;
    if (blend === this.envBlend) return;
    this.envBlend = blend;
    this.envMix.uniforms.tDay.value = day ?? sunset;
    this.envMix.uniforms.tSun.value = sunset ?? day;
    this.envMix.uniforms.uMix.value = blend;
    const next = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
    this.scene.environment = next.texture;
    this.envTarget?.dispose();
    this.envTarget = next;
    this.hdrTexture = next.texture;
  }

  /* ----------------------------- camera */

  private roofShown() {
    return this.roofOverride ?? FIRST_PERSON.has(this.view);
  }

  /** Roof and clerestory follow the view: open from above, closed from a seat. */
  private applyViewState() {
    const roof = this.roofShown();
    if (this.parts?.roof) this.parts.roof.visible = roof;
    this.fallbackRoof.visible = roof;
    this.festoon.visible = roof || this.time > 62;
    const planning = this.view === "overview" || this.view === "plan";
    // With the roof off the floor would mirror the open sky; damp it.
    if (this.reflector) {
      const warm = smooth(0.6, 0.86, this.time / 100);
      (this.reflector.material as THREE.ShaderMaterial).uniforms.uStrength.value = (0.7 + 0.2 * warm) * (roof ? 1 : 0.35 + 0.5 * warm);
    }
    for (const g of this.parts?.glass ?? []) {
      g.transparent = planning;
      g.opacity = planning ? 0.16 : 1;
      g.depthWrite = !planning;
      g.needsUpdate = true;
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  setRoof(show: boolean | null) {
    this.roofOverride = show;
    this.applyViewState();
  }

  get roofVisible() {
    return this.roofShown();
  }

  setView(view: ViewName, instant = false) {
    this.view = view;
    const aspect = this.camera.aspect;
    const narrow = aspect < 1 ? 1 / Math.max(0.5, aspect) : 1;
    const fp = FIRST_PERSON.has(view);
    const c = this.controls;
    c.enableRotate = view !== "plan";
    c.enableZoom = !fp;
    c.enablePan = !fp;
    c.minDistance = fp ? 0.01 : 3;
    c.maxDistance = fp ? 1 : 75;
    c.minPolarAngle = fp ? 0.45 : 0;
    c.maxPolarAngle = fp ? 2.45 : 1.48;
    c.rotateSpeed = fp ? 0.42 : 1;
    c.autoRotate = view === "overview" && !this.opts.reducedMotion;
    c.autoRotateSpeed = 0.35;
    this.applyViewState();
    let p: THREE.Vector3, t: THREE.Vector3, fov: number;
    if (view === "plan") {
      fov = 24;
      const half = 15.5;
      const f = THREE.MathUtils.degToRad(fov / 2);
      const h = half / (Math.tan(f) * Math.min(1, aspect));
      // Shift the room up a little so the control dock does not cover it.
      const dz = aspect < 1 ? 0 : 2.6;
      p = new THREE.Vector3(0, h * 1.12, dz + 0.001);
      t = new THREE.Vector3(0, 0, dz);
    } else {
      const pose = POSES[view];
      p = new THREE.Vector3(...pose.p);
      t = new THREE.Vector3(...pose.t);
      fov = pose.fov + (aspect < 1 ? 12 : 0);
      if (view === "overview") p.sub(t).multiplyScalar(narrow * 0.92).add(t);
      if (fp) t = p.clone().add(t.sub(p).normalize().multiplyScalar(0.6));
    }
    this.flyTo(p, t, fov, instant);
    this.applyTime();
  }

  private flyTo(p: THREE.Vector3, t: THREE.Vector3, fov: number, instant = false) {
    if (instant || this.opts.reducedMotion) {
      this.fly = null;
      this.camera.position.copy(p);
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.controls.target.copy(t);
      this.controls.update();
      return;
    }
    this.fly = {
      p0: this.camera.position.clone(),
      p1: p,
      t0: this.controls.target.clone(),
      t1: t,
      f0: this.camera.fov,
      f1: fov,
      start: performance.now(),
      dur: 1400,
    };
    this.controls.enableDamping = false;
  }

  /** Bring a table into view without leaving the current kind of view. */
  focusTable(id: string) {
    const t = this.tables.find((x) => x.id === id);
    if (!t || this.view === "plan") return;
    const cam = this.camera.position;
    const away = new THREE.Vector3(cam.x - t.x, 0, cam.z - t.z);
    if (away.lengthSq() < 0.01) away.set(0, 0, -1);
    away.normalize();
    const reach = Math.max(t.width, t.depth) / 2;
    if (FIRST_PERSON.has(this.view)) {
      const p = new THREE.Vector3(t.x, 1.25, t.z).addScaledVector(away, reach + 1.6);
      const look = new THREE.Vector3(t.x, 0.95, t.z).sub(p).normalize().multiplyScalar(0.6).add(p);
      this.flyTo(p, look, this.camera.fov);
    } else {
      this.controls.autoRotate = false;
      const p = new THREE.Vector3(t.x, 6.5, t.z).addScaledVector(away, reach + 7);
      this.flyTo(p, new THREE.Vector3(t.x, 0.6, t.z), this.camera.fov);
    }
  }

  /** WASD / arrows. First-person views walk; orbit views slide over the room. */
  private stepWalk(dt: number) {
    const w = this.walk;
    if (!w.f && !w.s && !w.t) return;
    this.fly = null;
    this.controls.autoRotate = false;
    const cam = this.camera.position,
      tgt = this.controls.target;
    const fp = FIRST_PERSON.has(this.view);
    if (w.t) {
      if (fp) {
        const off = tgt.clone().sub(cam).applyAxisAngle(Y, w.t * 1.5 * dt);
        tgt.copy(cam).add(off);
      } else {
        const off = cam.clone().sub(tgt).applyAxisAngle(Y, w.t * 1.2 * dt);
        cam.copy(tgt).add(off);
      }
    }
    const fwd = tgt.clone().sub(cam).setY(0);
    if (this.view === "plan") fwd.set(0, 0, -1);
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const base = fp ? 2.4 : this.view === "plan" ? 7 : 9;
    const speed = base * (w.fast ? 2.4 : 1);
    const d = fwd.multiplyScalar(w.f * speed * dt).addScaledVector(right, w.s * speed * dt);
    const lim = fp ? 44 : 30;
    const ref = fp ? cam : tgt;
    d.x = Math.max(-lim - ref.x, Math.min(lim - ref.x, d.x));
    d.z = Math.max(-lim - ref.z, Math.min(lim - ref.z, d.z));
    cam.add(d);
    tgt.add(d);
    this.onWalk?.();
  }

  /* ----------------------------- picking, labels and dragging */

  pick(clientX: number, clientY: number): string | null {
    this.cast(clientX, clientY);
    const hit = this.raycaster.intersectObjects(this.hits.children, false)[0];
    return (hit?.object.userData.id as string) ?? null;
  }

  private cast(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  private ground(clientX: number, clientY: number) {
    this.cast(clientX, clientY);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(Y, 0), p) ? p : null;
  }

  private posOf(t: LiveTable) {
    return this.drag?.id === t.id ? { x: this.drag.x, z: this.drag.z } : { x: t.x, z: t.z };
  }

  private onDown = (e: PointerEvent) => {
    if (!this.arrange || e.button !== 0 || this.drag) return;
    const id = this.pick(e.clientX, e.clientY);
    const t = id ? this.tables.find((x) => x.id === id) : null;
    const g = this.ground(e.clientX, e.clientY);
    if (!t || !g) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    this.drag = { id: t.id, ox: t.x - g.x, oz: t.z - g.z, x: t.x, z: t.z, pointerId: e.pointerId };
    this.onSelectTable?.(t.id);
    this.buildFurniture(
      this.tables.filter((x) => x.id !== t.id),
      this.furniture,
      this.hits,
    );
    this.buildFurniture([{ ...t, x: 0, z: 0 }], this.dragGroup, null);
    this.dragGroup.position.set(t.x, 0, t.z);
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.host.dataset.dragging = "1";
  };

  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const g = this.ground(e.clientX, e.clientY);
    const t = this.tables.find((x) => x.id === d.id);
    if (!g || !t) return;
    const pos = clampPosition({ ...t, guestIds: [] }, g.x + d.ox, g.z + d.oz);
    d.x = pos.x;
    d.z = pos.z;
    this.dragGroup.position.set(pos.x, 0, pos.z);
    this.updateRings();
  };

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    this.controls.enabled = true;
    delete this.host.dataset.dragging;
    this.clearGroup(this.dragGroup, true);
    this.dragGroup.position.set(0, 0, 0);
    const t = this.tables.find((x) => x.id === d.id);
    if (t && (t.x !== d.x || t.z !== d.z)) {
      // The owner commits the move and hands back new tables via setTables.
      const moved = this.tables.map((x) => (x.id === d.id ? { ...x, x: d.x, z: d.z } : x));
      this.setTables(moved);
      this.onMoveTable?.(d.id, d.x, d.z);
    } else this.setTables(this.tables);
  };

  /** A PNG of the current view (rendered now, so no preserved buffer is needed). */
  snapshot() {
    this.composer.render(0);
    return this.renderer.domElement.toDataURL("image/png");
  }

  project(): Projected[] {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    const v = new THREE.Vector3();
    return this.tables.map((t) => {
      const { x, z } = this.posOf(t);
      v.set(x, this.view === "plan" ? 0.8 : 1.45, z).project(this.camera);
      return {
        id: t.id,
        x: (v.x * 0.5 + 0.5) * w,
        y: (-v.y * 0.5 + 0.5) * h,
        visible: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1,
      };
    });
  }

  /* ----------------------------- loop and quality */

  private tick = () => {
    this.timer.update();
    const dt = Math.min(0.1, this.timer.getDelta());
    const now = performance.now();
    if (this.fly) {
      const f = Math.min(1, (now - this.fly.start) / this.fly.dur);
      const k = ease(f);
      this.camera.position.lerpVectors(this.fly.p0, this.fly.p1, k);
      this.controls.target.lerpVectors(this.fly.t0, this.fly.t1, k);
      this.camera.fov = this.fly.f0 + (this.fly.f1 - this.fly.f0) * k;
      this.camera.updateProjectionMatrix();
      if (f >= 1) {
        this.fly = null;
        this.controls.enableDamping = !this.opts.reducedMotion;
      }
    }
    if (this.timeAnim) {
      const f = Math.min(1, (now - this.timeAnim.start) / this.timeAnim.dur);
      this.time = this.timeAnim.from + (this.timeAnim.to - this.timeAnim.from) * ease(f);
      this.applyTime();
      this.applyViewState();
      this.onTime?.(this.time);
      if (f >= 1) this.timeAnim = null;
    }
    this.stepWalk(dt);
    this.controls.update(dt);
    const tt = this.timer.getElapsed();
    if (!this.opts.reducedMotion) {
      this.u.uTime.value = tt;
      const warm = smooth(0.6, 0.86, this.time / 100);
      if (this.garden) this.garden.fire.flame.opacity = (0.45 + 0.5 * warm) * (0.85 + Math.sin(tt * 9) * 0.1 + Math.sin(tt * 17.3) * 0.05);
      this.mats.flame.emissiveIntensity =
        (1.5 + 5 * warm) * (0.88 + Math.sin(tt * 11) * 0.06 + Math.sin(tt * 23.7) * 0.06);
      const n = this.parts?.water?.normalMap;
      if (n) n.offset.set(tt * 0.004, tt * 0.0025);
    }
    this.composer.render(dt);
    this.onFrame?.();
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 180) this.frameTimes.shift();
    if (now - this.lastStat > 1000) {
      this.lastStat = now;
      const s = this.stats();
      this.host.dataset.frameMs = s.frameMs.toFixed(1);
      this.host.dataset.fps = s.fps.toFixed(0);
      this.host.dataset.calls = String(s.calls);
      this.host.dataset.ratio = this.ratio.toFixed(2);
      this.host.dataset.cam = this.camera.position.toArray().map((n) => n.toFixed(2)).join(",");
    }
    this.adapt(now);
  };

  /**
   * Keep the frame rate up on weak GPUs: first lower the pixel ratio, then
   * drop the floor reflection, then shadows and bloom. Climb back slowly.
   */
  private adapt(now: number) {
    if (this.lockTier || document.hidden || now - this.lastAdapt < 2500 || this.frameTimes.length < 90) return;
    this.lastAdapt = now;
    const recent = this.frameTimes.slice(-90);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (avg > 30) {
      if (this.ratio > 0.8) {
        this.ratio = Math.max(0.75, this.ratio - 0.25);
        this.applyRatio();
      } else if (this.gtao?.enabled) {
        this.gtao.enabled = false;
      } else if (this.reflector) {
        this.removeReflector();
      } else if (this.tier !== "low") {
        this.setLowTier();
      }
      this.frameTimes.length = 0;
    } else if (avg < 13 && this.ratio < this.maxRatio) {
      this.ratio = Math.min(this.maxRatio, this.ratio + 0.15);
      this.applyRatio();
      this.frameTimes.length = 0;
    }
  }

  private applyRatio() {
    this.renderer.setPixelRatio(this.ratio);
    this.composer.setPixelRatio(this.ratio);
    this.onResize();
  }

  private setLowTier() {
    this.tier = "low";
    this.host.dataset.tier = "low";
    this.bloom.enabled = false;
    if (this.gtao) this.gtao.enabled = false;
    this.renderer.shadowMap.enabled = false;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) x.needsUpdate = true;
    });
  }

  stats() {
    const n = this.frameTimes.length || 1;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / n;
    return {
      frameMs: avg,
      fps: avg > 0 ? 1000 / avg : 0,
      calls: this.renderer.info.render.calls,
      tier: this.tier,
      ratio: this.ratio,
    };
  }

  private onResize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.gtao?.setSize(w * this.ratio, h * this.ratio);
    this.garden?.lakeMirror?.getRenderTarget().setSize(Math.round(w * this.ratio * 0.5), Math.round(h * this.ratio * 0.5));
    if (this.reflector) {
      const rw = Math.max(64, Math.round(w * this.ratio * 0.5)),
        rh = Math.max(64, Math.round(h * this.ratio * 0.5));
      this.reflector.getRenderTarget().setSize(rw, rh);
      (this.reflector.material as THREE.ShaderMaterial).uniforms.uTexel.value.set(1 / rw, 1 / rh);
    }
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resize.disconnect();
    this.controls.dispose();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onDown, true);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onUp);
    this.removeReflector();
    this.backdrop.dispose();
    disposeTree(this.scene);
    this.envTexture.dispose();
    this.envTarget?.dispose();
    this.hdr.day?.dispose();
    this.hdr.sunset?.dispose();
    this.garden?.dispose();
    this.gtao?.dispose();
    this.pmrem.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    el.remove();
  }
}
