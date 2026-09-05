import { expect, it } from "vitest";
import * as THREE from "three";
import {
  buildFurniture,
  buildShell,
  disposeObject,
  syncFurniture,
  styleFurniture,
} from "./scene";
import { initialTables } from "./model";
it("keeps verified dimensions and inferred geometry identifiable in the model", () => {
  const shell = buildShell();
  expect(shell.userData.widthMetres).toBe(28);
  expect(shell.userData.depthMetres).toBe(28);
  expect(shell.userData.heightMetres).toBe(8);
  expect(shell.getObjectByName("roof")).toBeDefined();
  expect(shell.userData.geometry).toContain("inferred");
  disposeObject(shell);
});
it("preserves table identity and metre coordinates for selection and Blender export", () => {
  const tables = initialTables();
  tables[0] = { ...tables[0], x: 5.25, z: -2, rotation: 90 };
  const furniture = buildFurniture(tables);
  expect(furniture.children).toHaveLength(16);
  const table = furniture.children.find(
    (t) => t.userData.tableId === tables[0].id,
  )!;
  expect(table.position.toArray()).toEqual([5.25, 0, -2]);
  expect(table.rotation.y).toBeCloseTo(-Math.PI / 2);
  expect(table.userData.capacity).toBe(8);
  disposeObject(furniture);
});

it("keeps detailed geometry when moving tables and rebuilds only changed occupancy", () => {
  const tables = initialTables();
  const furniture = buildFurniture(tables);
  const first = furniture.children[0],
    second = furniture.children[1];
  const moved = tables.map((t, i) =>
    i === 0 ? { ...t, x: 2, rotation: 45 } : t,
  );
  syncFurniture(furniture, moved);
  expect(furniture.children[0]).toBe(first);
  expect(first.position.x).toBe(2);
  expect(first.rotation.y).toBeCloseTo(-Math.PI / 4);
  syncFurniture(
    furniture,
    moved.map((t, i) => (i === 0 ? { ...t, guestIds: [] } : t)),
  );
  expect(
    furniture.children.find((g) => g.userData.tableId === tables[0].id),
  ).not.toBe(first);
  expect(
    furniture.children.find((g) => g.userData.tableId === tables[1].id),
  ).toBe(second);
  styleFurniture(furniture, undefined, { id: tables[1].id, valid: false });
  const top = second.getObjectByName("Tabletop") as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  >;
  expect(top.material.color.getHex()).toBe(0xd48a79);
  disposeObject(furniture);
});

it("batches detailed decoration while keeping every table raycastable", () => {
  const shell = buildShell(),
    furniture = buildFurniture(initialTables());
  let meshes = 0;
  for (const root of [shell, furniture])
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        meshes++;
        o.geometry.computeBoundingSphere();
        expect(Number.isFinite(o.geometry.boundingSphere!.radius)).toBe(true);
      }
    });
  expect(meshes).toBeLessThan(220);
  furniture.updateMatrixWorld(true);
  for (const t of initialTables()) {
    const ray = new THREE.Raycaster(
      new THREE.Vector3(t.x, 5, t.z),
      new THREE.Vector3(0, -1, 0),
    );
    const hit = ray.intersectObjects(furniture.children, true)[0];
    expect(hit).toBeDefined();
    let object: THREE.Object3D | null = hit.object;
    while (object && !object.userData.tableId) object = object.parent;
    expect(object?.userData.tableId).toBe(t.id);
  }
  disposeObject(shell);
  disposeObject(furniture);
});
