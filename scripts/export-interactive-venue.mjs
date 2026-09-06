// node scripts/export-interactive-venue.mjs — bundle the seating UI and 3D assets into one HTML.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFile(path.join(root, name), "utf8");
const assets = {};
for (const [key, filename, type] of [
  ["shell", "benavento-terrace-detailed.glb", "model/gltf-binary"],
  ["environment", "textures/rosendal_park_sunset_1k.hdr", "application/octet-stream"],
  ["decoderJs", "draco/draco_wasm_wrapper.js", "text/javascript"],
  ["decoderWasm", "draco/draco_decoder.wasm", "application/wasm"],
]) {
  assets[key] = { type, data: (await readFile(path.join(root, "public/venue", filename))).toString("base64") };
}

function replace(source, before, after) {
  if (!source.includes(before)) throw new Error(`Standalone build hook no longer matches: ${before.slice(0, 75)}`);
  return source.replace(before, after);
}

const bundle = await rolldown({
  input: path.join(root, "scripts/standalone-venue/entry.tsx"),
  platform: "browser",
  resolve: { alias: { "@": root } },
  transform: { jsx: "react-jsx", define: { "process.env.NODE_ENV": JSON.stringify("production") } },
  plugins: [{
    name: "standalone-venue",
    transform(code, id) {
      if (id.endsWith("/components/venue/VenuePrototype.tsx")) {
        code = replace(code, 'import dynamic from "next/dynamic";', 'import Scene from "./VenueScene";');
        const start = code.indexOf("const Scene = dynamic(");
        const end = code.indexOf("const KEY =", start);
        if (start < 0 || end < 0) throw new Error("Could not locate the Next.js scene wrapper.");
        code = code.slice(0, start) + code.slice(end);
        code = replace(code, "  initialDraft,", "  initialDraft as baseInitialDraft,");
        code = replace(code, 'const KEY = "benavento-terrace-concept-v1";', `
const snapshot = JSON.parse(document.getElementById("venue-initial-layout").textContent);
const initialDraft = () => snapshot.draft ? parseSavedDraft(snapshot.draft) : baseInitialDraft();
const KEY = "benavento-interactive-" + snapshot.id;`);
        code = replace(code, 'const TOUR_KEY = "benavento-terrace-tour-v1";', 'const TOUR_KEY = "benavento-interactive-tour-v1";');
        code = replace(code, '<a className="venue-back" href="/admin/seating">\n            ← Back to seating\n          </a>', '<span className="venue-back">Interactive Blender scene · standalone edition</span>');
        code = replace(code, '<h1>Try out your seating plan</h1>', '<h1>Your terrace, brought to life.</h1>');
        code = replace(code, '<summary>For the design team</summary>', '<summary>Save, share &amp; model details</summary>');
        code = replace(code, '["photos", "Venue photos"]', '["photos", "Venue photos (online)"]');
        return { code };
      }
      if (id.endsWith("/lib/venue/detailed-shell.ts")) {
        code = replace(code, '"/venue/benavento-terrace-detailed.glb"', 'globalThis.__VENUE_ASSETS.shell');
        code = replace(code, '"/venue/textures/rosendal_park_sunset_1k.hdr"', 'globalThis.__VENUE_ASSETS.environment');
        code = replace(code, '.setDecoderPath("/venue/draco/")', '.setDecoderPath({js: globalThis.__VENUE_ASSETS.decoderJs, wasm: globalThis.__VENUE_ASSETS.decoderWasm})');
        return { code };
      }
      if (id.endsWith("/loaders/DRACOLoader.js")) {
        // Default library URLs are immediately overridden with embedded blobs.
        return { code: code.replaceAll("import.meta.url", "document.baseURI") };
      }
    },
  }],
});
const { output } = await bundle.generate({ format: "iife", codeSplitting: false, minify: true });
await bundle.close();
const chunks = output.filter((item) => item.type === "chunk");
if (chunks.length !== 1 || output.length !== 1) throw new Error("Expected one self-contained JavaScript bundle.");
const code = chunks[0].code.replace(/<\/script/gi, "<\\/script");
const css = await read("app/venue-preview/venue.css");
const licenses = await Promise.all([
  ["React", "node_modules/react/LICENSE"],
  ["React DOM", "node_modules/react-dom/LICENSE"],
  ["Three.js", "node_modules/three/LICENSE"],
  ["Draco", "public/venue/draco/README.md"],
].map(async ([name, file]) => `${name}\n${await read(file)}`));
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Benavento — Interactive Blender Venue</title>
<meta name="description" content="Explore the Benavento terrace and arrange your seating plan. Standalone interactive Blender scene.">
<style>*{box-sizing:border-box}body{margin:0;background:#f7f7f0;font-family:Arial,Helvetica,sans-serif}button,input,select{font:inherit}img{max-width:100%}svg{display:block}button{touch-action:manipulation}
${css}
.standalone-notes{max-width:1520px;margin:0 auto;padding:0 40px 28px;font-size:12px;color:#65705e}.standalone-notes pre{white-space:pre-wrap}.startup{padding:48px;color:#40583f}#fatal:empty{display:none}#fatal{padding:24px;color:#8c2d20;background:#fff0e9}
</style></head><body>
<!--VENUE_LAYOUT_START--><script id="venue-initial-layout" type="application/json">{"id":"example-v1","draft":null}</script><!--VENUE_LAYOUT_END-->
<div id="root"><p class="startup">Opening your terrace…</p></div><p id="fatal" role="alert"></p>
<footer class="standalone-notes">The 3D scene and seating tools work offline. Venue photos and source links need internet. Changes stay in this browser; download another HTML copy to share your latest plan.
<details><summary>Credits &amp; open-source licenses</summary><p>Photo-referenced venue geometry: guest-crm. Garden lighting: <a href="https://polyhaven.com/a/rosendal_park_sunset">Rosendal Park Sunset, Poly Haven (CC0)</a>. Geometry and materials are illustrative; this is not a surveyed venue plan.</p><pre>${escape(licenses.join("\n\n"))}</pre></details></footer>
<script id="venue-bundled-assets" type="application/json">${JSON.stringify(assets)}</script>
<script>
window.addEventListener('error',function(e){document.getElementById('fatal').textContent='The viewer could not finish loading: '+e.message;});
globalThis.__VENUE_ASSETS = {};
for (const [key, asset] of Object.entries(JSON.parse(document.getElementById('venue-bundled-assets').textContent))) {
 const bytes=Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0));
 globalThis.__VENUE_ASSETS[key]=URL.createObjectURL(new Blob([bytes],{type:asset.type}));
}
</script><script>${code}</script></body></html>`;
const destination = path.join(root, "public/venue/benavento-interactive.html");
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, html);
console.log(`Built ${destination} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB).`);
