// Run with: node --experimental-strip-types scripts/export-venue-concept.mjs
import { writeFileSync } from "node:fs";
import { Scene } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  buildShell,
  buildFurniture,
  disposeObject,
} from "../lib/venue/scene.ts";
import { initialTables } from "../lib/venue/model.ts";
// GLTFExporter uses browser FileReader even when exporting geometry only.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
};
const scene = new Scene();
scene.add(buildShell(), buildFurniture(initialTables()));
const data = await new GLTFExporter().parseAsync(scene, { binary: true });
const loaded = await new GLTFLoader().parseAsync(data, "");
const tables = loaded.scene.getObjectByName("Editable_reception_furniture");
let tableCount = 0;
loaded.scene.traverse((o) => {
  if (o.userData.tableId) tableCount++;
});
if (tableCount !== 16)
  throw new Error(`Expected 16 exported tables, got ${tableCount}`);
writeFileSync("public/venue/benavento-terrace-concept.glb", Buffer.from(data));
console.log(
  `Exported and reloaded ${data.byteLength} bytes with ${tableCount} editable table groups.`,
);
disposeObject(scene);
disposeObject(loaded.scene);
