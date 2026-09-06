import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

export const DETAILED_SHELL_URL = "/venue/benavento-terrace-detailed.glb";
export const VENUE_ENVIRONMENT_URL =
  "/venue/textures/rosendal_park_sunset_1k.hdr";

/** Fade the clerestory when planning so tables remain visible behind it. */
export function setPlanningGlass(root: THREE.Object3D, planning: boolean) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material.name.startsWith("Reflective smoked clerestory glass")) continue;
      material.opacity = planning ? 0.2 : 1;
      material.transparent = planning;
      material.depthWrite = !planning;
      material.needsUpdate = true;
    }
  });
}

/** Each caller owns its geometry/materials; never share disposed GLTF instances. */
export async function loadDetailedShell(): Promise<THREE.Group> {
  const decoder = new DRACOLoader()
    .setDecoderPath("/venue/draco/")
    .setDecoderConfig({ type: "wasm" })
    .setWorkerLimit(2);
  let scene: THREE.Group;
  try {
    ({ scene } = await new GLTFLoader()
      .setDRACOLoader(decoder)
      .loadAsync(DETAILED_SHELL_URL));
  } finally {
    decoder.dispose();
  }
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    object.castShadow = !materials.some(
      (material) =>
        material.transparent ||
        (material instanceof THREE.MeshPhysicalMaterial &&
          material.transmission > 0),
    );
    object.receiveShadow = true;
  });
  return scene;
}
