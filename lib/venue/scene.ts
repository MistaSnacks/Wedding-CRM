import * as THREE from "three";
import {
  mergeGeometries,
  mergeVertices,
} from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { LayoutTable } from "./model";

type V3 = [number, number, number];
function material(color: number, roughness = 0.6, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}
function mesh(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  mat: THREE.Material,
  position: V3 = [0, 0, 0],
) {
  const m = new THREE.Mesh(geometry, mat);
  m.name = name;
  m.position.set(...position);
  m.castShadow = !(mat as THREE.MeshStandardMaterial).transparent;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function box(
  parent: THREE.Object3D,
  name: string,
  size: V3,
  position: V3,
  mat: THREE.Material,
) {
  return mesh(parent, name, new THREE.BoxGeometry(...size), mat, position);
}
function rod(
  parent: THREE.Object3D,
  name: string,
  a: V3,
  b: V3,
  r: number,
  mat: THREE.Material,
) {
  const start = new THREE.Vector3(...a),
    end = new THREE.Vector3(...b),
    delta = end.clone().sub(start);
  const m = mesh(
    parent,
    name,
    new THREE.CylinderGeometry(r, r, delta.length(), 8),
    mat,
  );
  m.position.copy(start.add(end).multiplyScalar(0.5));
  m.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize(),
  );
  return m;
}
function curve(
  parent: THREE.Object3D,
  name: string,
  points: V3[],
  radius: number,
  mat: THREE.Material,
  segments = 12,
) {
  return mesh(
    parent,
    name,
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))),
      segments,
      radius,
      5,
      false,
    ),
    mat,
  );
}

// Batch decoration by material within the shell or each table. Table identity and
// the individually tintable tabletop remain separate for raycasting and dragging.
function batchDecoration(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map<
    THREE.Material,
    { geometries: THREE.BufferGeometry[]; sources: THREE.Mesh[] }
  >();
  function visit(o: THREE.Object3D) {
    if (o.userData.keepSeparate) return;
    if (o instanceof THREE.Mesh && !Array.isArray(o.material)) {
      const transformed = o.geometry
        .clone()
        .applyMatrix4(inverse.clone().multiply(o.matrixWorld));
      const geometry = transformed.index
        ? transformed.toNonIndexed()
        : transformed;
      if (geometry !== transformed) transformed.dispose();
      const bucket = buckets.get(o.material) ?? { geometries: [], sources: [] };
      bucket.geometries.push(geometry);
      bucket.sources.push(o);
      buckets.set(o.material, bucket);
    }
    for (const child of o.children) visit(child);
  }
  for (const child of root.children) visit(child);
  for (const [mat, bucket] of buckets) {
    const geometry = mergeGeometries(bucket.geometries, false);
    for (const g of bucket.geometries) g.dispose();
    if (!geometry) throw new Error("Could not batch venue decoration.");
    for (const source of bucket.sources) {
      source.removeFromParent();
      source.geometry.dispose();
    }
    const indexed = mergeVertices(geometry);
    geometry.dispose();
    mesh(root, mat.name || "Venue detail", indexed, mat);
  }
}
function palm(
  root: THREE.Group,
  x: number,
  z: number,
  phase: number,
  bark: THREE.Material,
  leaf: THREE.Material,
) {
  const height = 5.6 + Math.sin(phase) * 0.45;
  mesh(
    root,
    "Palm trunk",
    new THREE.CylinderGeometry(0.12, 0.23, height, 10),
    bark,
    [x, height / 2 - 0.32, z],
  );
  for (let ring = 0; ring < 12; ring++) {
    const band = mesh(
      root,
      "Trunk growth ring",
      new THREE.TorusGeometry(0.18 - ring * 0.003, 0.012, 3, 10),
      bark,
      [x, ring * 0.4 + 0.3, z],
    );
    band.rotation.x = Math.PI / 2;
  }
  for (let f = 0; f < 9; f++) {
    const angle = (f / 9) * Math.PI * 2 + phase;
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)),
      side = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
    const path = (t: number) =>
      new THREE.Vector3(
        x,
        height - 0.3 + Math.sin(t * Math.PI) * 0.65 - t * 0.7,
        z,
      ).addScaledVector(dir, t * 2.8);
    curve(
      root,
      "Arching palm frond",
      [path(0).toArray(), path(0.5).toArray(), path(1).toArray()],
      0.025,
      leaf,
      8,
    );
    for (let n = 1; n < 9; n++)
      for (const sign of [-1, 1]) {
        const t = n / 10,
          base = path(t),
          tip = base
            .clone()
            .addScaledVector(side, sign * Math.sin(t * Math.PI) * 0.7)
            .addScaledVector(dir, 0.35);
        tip.y -= 0.18;
        const back = base.clone().addScaledVector(dir, -0.07),
          front = base.clone().addScaledVector(dir, 0.12);
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(
            [...back.toArray(), ...tip.toArray(), ...front.toArray()],
            3,
          ),
        );
        g.setAttribute(
          "uv",
          new THREE.Float32BufferAttribute([0, 0, 0.5, 1, 1, 0], 2),
        );
        g.computeVertexNormals();
        mesh(root, "Palm leaflet", g, leaf);
      }
  }
}
export function buildShell() {
  const root = new THREE.Group();
  root.name = "Benavento terrace — concept, not surveyed";
  root.userData = {
    source: "https://benavento.com/espacios-para-eventos/",
    widthMetres: 28,
    depthMetres: 28,
    heightMetres: 8,
    geometry:
      "Only overall dimensions verified; structure and landscaping inferred from photographs.",
  };
  const steel = material(0x263336, 0.32, 0.72),
    stone = material(0xaaa99f, 0.45),
    grass = material(0x8c9b78, 0.98),
    brass = material(0xb39867, 0.3, 0.68),
    wood = material(0xbbaa86, 0.5);
  steel.name = "Architectural steel";
  stone.name = "Stone platform";
  grass.name = "Garden";
  brass.name = "Brass details";
  wood.name = "Dance floor parquet";
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xb9d9d7,
    roughness: 0.12,
    metalness: 0.08,
    transparent: true,
    opacity: 0.17,
    depthWrite: false,
    side: THREE.DoubleSide,
    clearcoat: 1,
  });
  glass.name = "Upper glazing";
  box(
    root,
    "Landscape context — approximate",
    [70, 0.15, 65],
    [0, -0.4, 0],
    grass,
  );
  box(root, "28 × 28 m platform", [28, 0.3, 28], [0, -0.15, 0], stone);
  const tileMaterials = [0xc4c2b9, 0xceccc3, 0xbcbdb6, 0xd6d3c9].map((c) =>
    material(c, 0.3, 0.04),
  );
  tileMaterials.forEach((m) => (m.name = "Honed stone paving"));
  for (let x = 0; x < 14; x++)
    for (let z = 0; z < 14; z++)
      box(
        root,
        "Stone slab",
        [1.988, 0.015, 1.988],
        [-13 + x * 2, 0.015, -13 + z * 2],
        tileMaterials[(x * 7 + z * 3 + Math.floor(x / 3)) % 4],
      );
  for (const x of [-11.8, 11.8])
    for (const z of [-11.8, 11.8]) {
      box(
        root,
        "Steel support — estimated position",
        [0.26, 8, 0.26],
        [x, 4, z],
        steel,
      );
      box(root, "Column base plate", [0.55, 0.045, 0.55], [x, 0.055, z], steel);
      for (const dx of [-0.19, 0.19])
        for (const dz of [-0.19, 0.19])
          mesh(
            root,
            "Anchor bolt",
            new THREE.CylinderGeometry(0.025, 0.025, 0.04, 6),
            brass,
            [x + dx, 0.085, z + dz],
          );
    }
  for (const y of [4, 8]) {
    for (const z of [-14, 14])
      box(root, "Perimeter steel", [28, 0.22, 0.18], [0, y, z], steel);
    for (const x of [-14, 14])
      box(root, "Perimeter steel", [0.18, 0.22, 28], [x, y, 0], steel);
  }
  for (const x of [-14, 14])
    box(root, "Upper glass band", [0.03, 3.65, 28], [x, 6, 0], glass);
  for (const z of [-14, 14])
    box(root, "Upper glass band", [28, 3.65, 0.03], [0, 6, z], glass);
  for (let p = -12; p <= 12; p += 3) {
    for (const edge of [-14, 14]) {
      box(root, "Glazing mullion", [0.055, 3.8, 0.07], [p, 6, edge], steel);
      box(root, "Glazing mullion", [0.07, 3.8, 0.055], [edge, 6, p], steel);
    }
  }
  const roof = new THREE.Group();
  roof.name = "roof";
  roof.userData.keepSeparate = true;
  box(roof, "Roof plane — inferred", [28, 0.12, 28], [0, 8.12, 0], steel);
  for (let p = -12; p <= 12; p += 4) {
    box(roof, "Roof beam", [28, 0.18, 0.12], [0, 7.85, p], steel);
    box(roof, "Roof beam", [28, 0.1, 0.1], [0, 7.2, p], steel);
    box(roof, "Cross beam", [0.12, 0.3, 28], [p, 7.8, 0], steel);
    for (let x = -14; x < 14; x += 2)
      rod(
        roof,
        "Roof truss diagonal",
        [x, 7.2, p],
        [x + 2, 7.85, p],
        0.035,
        steel,
      );
  }
  batchDecoration(roof);
  root.add(roof);
  box(
    root,
    "Suggested dance floor — concept",
    [9, 0.025, 4],
    [0, 0.04, 0],
    wood,
  );
  for (let i = 0; i < 18; i++)
    box(
      root,
      "Parquet seam",
      [0.012, 0.004, 3.97],
      [-4.25 + i * 0.5, 0.055, 0],
      stone,
    );
  for (const z of [-2, 2])
    box(root, "Dance floor edging", [9, 0.02, 0.035], [0, 0.065, z], brass);
  for (const x of [-4.5, 4.5])
    box(root, "Dance floor edging", [0.035, 0.02, 4], [x, 0.065, 0], brass);
  const water = new THREE.MeshPhysicalMaterial({
    color: 0x568a8c,
    roughness: 0.19,
    metalness: 0.3,
    clearcoat: 1,
  });
  water.name = "Reflective lake";
  const lakeGeometry = new THREE.PlaneGeometry(52, 12, 90, 24);
  lakeGeometry.rotateX(-Math.PI / 2);
  const vertices = lakeGeometry.attributes.position;
  for (let i = 0; i < vertices.count; i++)
    vertices.setY(
      i,
      Math.sin(vertices.getX(i) * 2.4 + vertices.getZ(i) * 3) * 0.018 +
        Math.cos(vertices.getX(i) * 0.8) * 0.015,
    );
  lakeGeometry.computeVertexNormals();
  const lake = mesh(
    root,
    "Lake context — approximate",
    lakeGeometry,
    water,
    [0, -0.27, 23],
  );
  lake.castShadow = false;
  box(
    root,
    "Lakeside stone border — context",
    [52, 0.25, 0.5],
    [0, -0.3, 16.8],
    stone,
  );
  const bark = material(0x8a806a, 0.94),
    leaf = material(0x526b3f, 0.86);
  leaf.side = THREE.DoubleSide;
  leaf.name = "Palm foliage";
  bark.name = "Palm bark";
  for (const x of [-18, 18])
    for (const z of [-12, -4, 4, 12]) palm(root, x, z, z * 0.15, bark, leaf);
  batchDecoration(root);
  return root;
}

export function buildFurniture(tables: LayoutTable[], selected?: string) {
  const root = new THREE.Group();
  root.name = "Editable reception furniture";
  for (const table of tables) {
    const linen = new THREE.MeshPhysicalMaterial({
      color: 0xf2ede1,
      roughness: 0.93,
      sheen: 0.65,
      sheenColor: new THREE.Color(0xffffff),
    });
    linen.name = "Draped ivory linen";
    const gold = material(0xb59a67, 0.27, 0.78),
      cushion = material(0xc8bd9f, 0.91),
      occupied = material(0x768b77, 0.9),
      porcelain = material(0xfaf5e9, 0.24),
      napkin = material(0x819076, 0.96),
      foliage = material(0x5b704c, 0.85),
      flower = material(0xe9ded0, 0.8);
    gold.name = "Champagne chair frames and cutlery";
    cushion.name = "Empty chair upholstery";
    occupied.name = "Occupied chair upholstery";
    porcelain.name = "Porcelain";
    napkin.name = "Sage napkins";
    foliage.name = "Centre arrangement foliage";
    flower.name = "Ivory flowers";
    const crystal = new THREE.MeshPhysicalMaterial({
      color: 0xe4efeb,
      metalness: 0.12,
      roughness: 0.08,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    crystal.name = "Stemware";
    const g = new THREE.Group();
    g.name = table.name;
    g.userData = {
      appearance: furnitureAppearance(table),
      tableId: table.id,
      capacity: table.capacity,
      assignedSampleGuests: table.guestIds.length,
    };
    const top = mesh(
      g,
      "Tabletop",
      table.shape === "round"
        ? new THREE.CylinderGeometry(
            table.width / 2,
            table.width / 2,
            0.055,
            64,
          )
        : new RoundedBoxGeometry(table.width, 0.055, table.depth, 2, 0.025),
      linen.clone(),
      [0, 0.78, 0],
    );
    top.userData.keepSeparate = true;
    const skirt =
      table.shape === "round"
        ? new THREE.CylinderGeometry(
            table.width / 2,
            table.width / 2 + 0.05,
            0.58,
            96,
            5,
            true,
          )
        : new THREE.BoxGeometry(table.width, 0.58, table.depth, 30, 5, 16);
    const pos = skirt.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i),
        z = pos.getZ(i),
        drop = (0.29 - y) / 0.58;
      if (table.shape === "round") {
        const a = Math.atan2(z, x),
          fold = Math.sin(a * 28) * 0.026 * drop;
        pos.setX(i, x + Math.cos(a) * fold);
        pos.setZ(i, z + Math.sin(a) * fold);
      } else {
        if (Math.abs(x) > table.width / 2 - 0.001)
          pos.setX(i, x + Math.sign(x) * Math.sin(z * 35) * 0.016 * drop);
        if (Math.abs(z) > table.depth / 2 - 0.001)
          pos.setZ(i, z + Math.sign(z) * Math.sin(x * 35) * 0.016 * drop);
      }
    }
    skirt.computeVertexNormals();
    mesh(g, "Linen folds", skirt, linen, [0, 0.465, 0]);
    for (let i = 0; i < table.capacity; i++) {
      const a = (i / table.capacity) * Math.PI * 2,
        s = Math.sin(a),
        c = Math.cos(a);
      const chair = new THREE.Group();
      chair.position.set(
        s * (table.width / 2 + 0.38),
        0,
        c * (table.depth / 2 + 0.38),
      );
      chair.rotation.y = a;
      g.add(chair);
      mesh(
        chair,
        "Upholstered chair seat",
        new RoundedBoxGeometry(0.42, 0.07, 0.42, 2, 0.035),
        i < table.guestIds.length ? occupied : cushion,
        [0, 0.45, 0],
      );
      for (const dx of [-0.17, 0.17])
        for (const dz of [-0.17, 0.17])
          rod(
            chair,
            "Tapered chair leg",
            [dx * 1.12, 0.035, dz * 1.12],
            [dx, 0.45, dz],
            0.017,
            gold,
          );
      curve(
        chair,
        "Curved chair back",
        [
          [-0.19, 0.46, 0.19],
          [-0.19, 0.85, 0.2],
          [0, 0.99, 0.22],
          [0.19, 0.85, 0.2],
          [0.19, 0.46, 0.19],
        ],
        0.019,
        gold,
        16,
      );
      for (const dx of [-0.1, 0, 0.1])
        rod(
          chair,
          "Chair back spindle",
          [dx, 0.48, 0.2],
          [dx, 0.91 - Math.abs(dx) * 0.3, 0.22],
          0.01,
          gold,
        );
      const setting = new THREE.Group();
      setting.position.set(
        s * Math.max(0.2, table.width / 2 - 0.25),
        0.822,
        c * Math.max(0.2, table.depth / 2 - 0.25),
      );
      setting.rotation.y = a;
      g.add(setting);
      mesh(
        setting,
        "Gold charger",
        new THREE.CylinderGeometry(0.15, 0.15, 0.008, 24),
        gold,
      );
      mesh(
        setting,
        "Dinner plate",
        new THREE.CylinderGeometry(0.128, 0.115, 0.015, 24),
        porcelain,
        [0, 0.012, 0],
      );
      box(
        setting,
        "Folded linen napkin",
        [0.08, 0.013, 0.17],
        [0, 0.028, 0],
        napkin,
      );
      for (const dx of [-0.19, 0.19])
        rod(
          setting,
          "Flatware",
          [dx, 0.014, -0.075],
          [dx, 0.014, 0.075],
          0.008,
          gold,
        );
      mesh(
        setting,
        "Glass foot",
        new THREE.CylinderGeometry(0.034, 0.034, 0.005, 12),
        crystal,
        [0.19, 0.005, -0.18],
      );
      rod(
        setting,
        "Glass stem",
        [0.19, 0.008, -0.18],
        [0.19, 0.09, -0.18],
        0.006,
        crystal,
      );
      mesh(
        setting,
        "Wine glass bowl",
        new THREE.LatheGeometry(
          [
            new THREE.Vector2(0.008, 0),
            new THREE.Vector2(0.041, 0.04),
            new THREE.Vector2(0.037, 0.085),
          ],
          12,
        ),
        crystal,
        [0.19, 0.09, -0.18],
      );
    }
    mesh(
      g,
      "Low centerpiece bowl",
      new THREE.CylinderGeometry(0.18, 0.12, 0.13, 20),
      gold,
      [0, 0.88, 0],
    );
    for (let n = 0; n < 13; n++) {
      const a = n * 2.4,
        r = n === 0 ? 0 : 0.09 + Math.sin(n * 3) * 0.12;
      const sprig = mesh(
        g,
        "Arrangement foliage",
        new THREE.SphereGeometry(0.105, 8, 6),
        foliage,
        [Math.cos(a) * r, 1 + Math.cos(n) * 0.035, Math.sin(a) * r],
      );
      sprig.scale.set(1.25, 0.5, 0.75);
      mesh(g, "Ivory blossom", new THREE.IcosahedronGeometry(0.07, 1), flower, [
        Math.cos(a) * r,
        1.075 + Math.cos(n * 2) * 0.045,
        Math.sin(a) * r,
      ]);
    }
    batchDecoration(g);
    g.position.set(table.x, 0, table.z);
    g.rotation.y = (-table.rotation * Math.PI) / 180;
    root.add(g);
  }
  styleFurniture(root, selected);
  return root;
}
function furnitureAppearance(t: LayoutTable) {
  return [t.shape, t.width, t.depth, t.capacity, t.guestIds.length].join(":");
}

/** Update transforms without rebuilding geometry; rebuild only changed seating. */
export function syncFurniture(root: THREE.Group, tables: LayoutTable[]) {
  const wanted = new Set(tables.map((t) => t.id));
  for (const child of [...root.children])
    if (!wanted.has(child.userData.tableId)) {
      root.remove(child);
      disposeObject(child);
    }
  for (const table of tables) {
    let group = root.children.find((g) => g.userData.tableId === table.id);
    if (group && group.userData.appearance !== furnitureAppearance(table)) {
      root.remove(group);
      disposeObject(group);
      group = undefined;
    }
    if (!group) {
      group = buildFurniture([table]).children[0];
      root.add(group);
    }
    group.name = table.name;
    group.position.set(table.x, 0, table.z);
    group.rotation.y = (-table.rotation * Math.PI) / 180;
  }
}
export function styleFurniture(
  root: THREE.Group,
  selected?: string,
  drop?: { id: string; valid: boolean } | null,
) {
  for (const g of root.children) {
    const top = g.getObjectByName("Tabletop");
    if (
      top instanceof THREE.Mesh &&
      top.material instanceof THREE.MeshStandardMaterial
    ) {
      top.material.color.set(
        drop && drop.id === g.userData.tableId
          ? drop.valid
            ? 0x80b28c
            : 0xd48a79
          : selected === g.userData.tableId
            ? 0xd5bd8e
            : 0xf2ede1,
      );
    }
  }
}
export function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        materials.add(m);
    }
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}
