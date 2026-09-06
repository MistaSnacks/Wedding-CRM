# Blender venue workflow — 5 September 2026

## Connection

Blender 5.2.1 LTS is installed at `/Applications/Blender.app`. The missing menu was caused by the add-on not being installed in Blender's 5.2 user profile. Updating Blender does not install this third-party integration.

Installed `blender-mcp==1.9.1` with `uvx --python 3.11 blender-mcp==1.9.1 install-addon`. The add-on lives at `~/Library/Application Support/Blender/5.2/scripts/addons/blender_mcp.py`; its displayed name is **MCP for Blender**, in Preferences → Add-ons and the 3D Viewport's N sidebar. Its own `bl_info` version is 1.6; the client package version is 1.9.1. These are separate version numbers.

Codex's global `blender` MCP entry uses the absolute uvx path, Python 3.11, localhost port 9876, and `DISABLE_TELEMETRY=true`. The Blender preference also has telemetry disabled. The live MCP reports matching protocol version 5 and successfully reads the scene. Blender must be open for that connection to work. This add-on version starts its listener automatically when enabled in the GUI; background Blender can author/render files but cannot run its command listener.

Sources: [Blender MCP installation](https://github.com/ahujasid/blender-mcp#installation), [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Current artifacts

- `assets/blender/benavento-terrace.blend`: editable scene, 16 sample table roots retain stable table IDs, metric scale, packed textures, three cameras, Cycles lighting. Original Blender scene is retained separately.
- `assets/blender/benavento-terrace-interior.png`: reviewed 1440 × 1000 Cycles render, 48 samples and denoising.
- `public/venue/benavento-terrace-detailed.glb`: shell only, approximately 3.7 MiB, Draco compression, 18 exported meshes, approximately 289,000 triangles. No seating or guest data in the shell.
- `scripts/blender/build-terrace.py`: procedural authoring script. In an existing dedicated studio scene it replaces the generated shell and its cameras/lights, retaining furniture. Otherwise it creates a new studio scene and imports the starter concept.
- `public/venue/textures/`: procedural marble map and Poly Haven assets; source/license manifest accompanies the downloaded assets. The garden HDRI is lighting reference, not a photograph of Benavento. The current scene uses the authored grey marble and the garden HDRI.
- `public/venue/draco/`: decoder distributed with the installed Three.js package, served locally; no decoder CDN dependency.

The preview at `/venue-preview` loads the Blender-authored shell while keeping app-generated furniture and all existing seating operations. Overview fades the clerestory for table visibility. Guest view and Garden retain the reflective glass. Roof visibility, lighting, floor-plan mode, table IDs, shape/capacity edits, guest assignment, undo, and browser-local draft persistence retain their existing state model. GLB download now combines the detailed shell with the current editable furniture layout.

The shell loads asynchronously; the procedural concept remains visible during loading and if loading fails, with an explicit status message. The HDRI also has a studio-environment fallback. Geometry, materials, textures, decoder workers and late asynchronous results are disposed when the view unmounts.

## Rebuild

From the repository root:

```sh
node --experimental-strip-types scripts/export-venue-concept.mjs
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/build-terrace.py
```

For live authoring through MCP, run the script using `runpy.run_path` in Blender's Python environment. The script derives the project root from its own path. Keep the source texture files available when rebuilding; the saved `.blend` packs them for portability. Re-export only the shell and its children, including the `roof` root, with glTF extras enabled and 16-bit Draco position quantization. Preserve metres, origin, and axis conversion (Blender Z-up → glTF Y-up).

The committed exception for the detailed GLB in `.gitignore` ensures a future Git deployment can include it. The generated starter GLB and Blender backup files remain ignored.

## Standalone interactive HTML

`public/venue/benavento-interactive.html` is a single approximately 8.4 MiB file containing the same React seating UI, Three.js viewer, compressed shell, Draco decoder and HDRI. Open it directly in a browser; the 3D scene and seating tools do not require a server or internet connection. The optional venue-photo gallery and source links remain online references.

The app's **For the design team → Download interactive HTML** button embeds the current draft, including names, assignments, table shapes and positions. The standalone file can export another HTML copy with later edits. Each exported snapshot has its own browser-storage key, separate from the app and other exports. The checked-in HTML contains sample data, never a user's browser draft.

Rebuild with `node scripts/export-interactive-venue.mjs` after changes to the preview or model. It uses Rolldown from the installed development toolchain and checks its targeted standalone transforms. The checked-in HTML is served directly; the production build does not need to regenerate it. The build removes the Next.js dynamic wrapper only in the standalone bundle and embeds asset URLs as blobs. Open-source notices and lighting attribution are included in the file.

Verified in Safari using `file://`: detailed model rendering, family seating, full-table rejection, and re-export. The downloaded copy contains the edited 68-seat snapshot. Fifteen venue tests cover existing behavior plus snapshot validation and HTML/script escaping.

## Accuracy and verification

The [venue's published terrace dimensions](https://benavento.com/espacios-para-eventos/) establish the 28 × 28 m marble platform and 8 m internal height. Four empty-room photos in the existing reference archive informed the graphite steel, mirrored upper glazing, grey marble, space-frame roof, date palms and stepped lake-side planters. Support locations, planting, landscape levels, detailed structure and furniture are inferred. This is an initial photo-referenced visualization, not an exact surveyed replica or a completed reconstruction of every Benavento space. Actual entrances and fixed obstacles need the venue's measured plan before treating it as authoritative for seating.

Verified: add-on registration and live MCP scene access; 13 existing venue tests; TypeScript; production build; compressed shell metadata (roof root, published dimensions, no table roots); actual browser decoding and display; family seating updates from 64 to 68 seated guests and fills the selected table atomically. Browser camera/table controls were also in active use by the user during review, so further automation was stopped to preserve their draft. Full repeat browser regression, all device performance checks, and a post-change GLB-download round trip were not completed in this pass.
