"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { loadDetailedShell, setPlanningGlass, VENUE_ENVIRONMENT_URL } from "@/lib/venue/detailed-shell";
import {
  buildShell,
  buildFurniture,
  disposeObject,
  styleFurniture,
  syncFurniture,
} from "@/lib/venue/scene";
import { clampPosition, type LayoutTable } from "@/lib/venue/model";

import type { DropPreview, TableHitTest } from "./drag";

type Props = {
  hitTestRef: RefObject<TableHitTest | null>;
  dropPreview: DropPreview;
  tables: LayoutTable[];
  selected: string;
  roof: boolean;
  warmLight: boolean;
  move: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, z: number) => void;
};
export default function VenueScene(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    latest = useRef(props),
    runtime = useRef<{
      scene: THREE.Scene;
      tables: LayoutTable[];
      renderer: THREE.WebGLRenderer;
      sun: THREE.DirectionalLight;
      fill: THREE.HemisphereLight;
      furniture: THREE.Group;
      shell: THREE.Group;
      camera: THREE.PerspectiveCamera;
      controls: OrbitControls;
      render: () => void;
    } | null>(null);
  const [error, setError] = useState(false);
  const [modelStatus, setModelStatus] = useState("Loading venue details…");
  const [view, setView] = useState("Overview");
  const viewRef = useRef("Overview");
  function changeView(next: string) {
    const r = runtime.current;
    if (!r) return;
    const positions: Record<string, [number, number, number]> = {
      Overview: [34, 31, 39],
      "Guest view": [10, 1.8, 11],
      Garden: [27, 6, 37],
    };
    r.camera.position.set(...positions[next]);
    r.controls.target.set(0, next === "Guest view" ? 1.8 : 2, 0);
    setPlanningGlass(r.shell, next === "Overview");
    r.controls.update();
    r.render();
    setView(next);
    viewRef.current = next;
  }
  latest.current = props;
  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setError(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xe7e9e2);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(43, 1, 0.1, 200);
    camera.position.set(34, 31, 39);
    scene.fog = new THREE.Fog(0xe7e9e2, 55, 115);
    const environment = new RoomEnvironment(),
      pmrem = new THREE.PMREMGenerator(renderer);
    let envTarget = pmrem.fromScene(environment, 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.45;
    environment.dispose();
    const fill = new THREE.HemisphereLight(0xe7f1ff, 0x96947a, 1.1);
    scene.add(fill);
    const sun = new THREE.DirectionalLight(0xffe5bb, 3.3);
    sun.position.set(-24, 32, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -25,
      right: 25,
      top: 25,
      bottom: -25,
      near: 1,
      far: 100,
    });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.normalBias = 0.025;
    sun.shadow.bias = -0.00015;
    sun.shadow.radius = 2;
    scene.add(sun);
    const shell = buildShell(),
      furniture = buildFurniture(
        latest.current.tables,
        latest.current.selected,
      );
    scene.add(shell, furniture);
    shell.getObjectByName("roof")!.visible = latest.current.roof;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.minDistance = 2;
    controls.maxDistance = 95;
    controls.update();
    const render = () => renderer.render(scene, camera);
    runtime.current = {
      scene,
      shell,
      furniture,
      render,
      renderer,
      sun,
      fill,
      camera,
      controls,
      tables: latest.current.tables,
    };
    void loadDetailedShell().then((detailed) => {
      if (disposed) {
        disposeObject(detailed);
        return;
      }
      const roof = detailed.getObjectByName("roof");
      if (roof) roof.visible = latest.current.roof;
      setPlanningGlass(detailed, viewRef.current === "Overview");
      scene.remove(shell);
      disposeObject(shell);
      scene.add(detailed);
      runtime.current!.shell = detailed;
      setModelStatus("Detailed venue");
      render();
    }).catch(() => {
      if (!disposed) setModelStatus("Venue details unavailable · showing the simplified view");
    });
    void new HDRLoader().loadAsync(VENUE_ENVIRONMENT_URL).then((hdr) => {
      if (disposed) { hdr.dispose(); return; }
      const nextEnvironment = pmrem.fromEquirectangular(hdr);
      hdr.dispose();
      envTarget.dispose();
      envTarget = nextEnvironment;
      scene.environment = envTarget.texture;
      render();
    }).catch(() => { /* The studio environment remains a usable fallback. */ });
    controls.addEventListener("change", render);
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    const ray = new THREE.Raycaster(),
      pointer = new THREE.Vector2(),
      plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      point = new THREE.Vector3();
    let drag: {
      id: string;
      offsetX: number;
      offsetZ: number;
      x: number;
      z: number;
    } | null = null;
    const cast = (e: { clientX: number; clientY: number }) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(pointer, camera);
    };
    const hitTestRef = latest.current.hitTestRef;
    hitTestRef.current = (x, y) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      if (
        x < bounds.left ||
        x > bounds.right ||
        y < bounds.top ||
        y > bounds.bottom
      )
        return null;
      cast({ clientX: x, clientY: y });
      let obj: THREE.Object3D | null =
        ray.intersectObjects(runtime.current!.furniture.children, true)[0]
          ?.object ?? null;
      while (obj && !obj.userData.tableId) obj = obj.parent;
      return obj?.userData.tableId ?? null;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      cast(e);
      const hit = ray.intersectObjects(
        runtime.current!.furniture.children,
        true,
      )[0];
      if (!hit) return;
      let obj: THREE.Object3D | null = hit.object;
      while (obj && !obj.userData.tableId) obj = obj.parent;
      if (!obj) return;
      const id = obj.userData.tableId as string;
      latest.current.onSelect(id);
      if (latest.current.move && ray.ray.intersectPlane(plane, point)) {
        e.stopImmediatePropagation();
        controls.enabled = false;
        drag = {
          id,
          offsetX: obj.position.x - point.x,
          offsetZ: obj.position.z - point.z,
          x: obj.position.x,
          z: obj.position.z,
        };
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      cast(e);
      if (!ray.ray.intersectPlane(plane, point)) return;
      const table = latest.current.tables.find((t) => t.id === drag!.id);
      if (!table) return;
      const pos = clampPosition(
        table,
        point.x + drag.offsetX,
        point.z + drag.offsetZ,
      );
      drag.x = pos.x;
      drag.z = pos.z;
      const obj = runtime.current!.furniture.children.find(
        (o) => o.userData.tableId === drag!.id,
      );
      if (obj) obj.position.set(pos.x, 0, pos.z);
      render();
    };
    const up = () => {
      if (drag) {
        latest.current.onMove(drag.id, drag.x, drag.z);
        drag = null;
      }
      controls.enabled = true;
    };
    renderer.domElement.addEventListener("pointerdown", down, true);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointercancel", up);
    return () => {
      disposed = true;
      hitTestRef.current = null;
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", down, true);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("pointercancel", up);
      envTarget.dispose();
      pmrem.dispose();
      sun.shadow.map?.dispose();
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, []);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    if (r.tables !== props.tables) {
      syncFurniture(r.furniture, props.tables);
      r.tables = props.tables;
    }
    styleFurniture(r.furniture, props.selected, props.dropPreview);
    const roof = r.shell.getObjectByName("roof");
    if (roof) roof.visible = props.roof;
    r.sun.color.set(props.warmLight ? 0xffdfa6 : 0xfff5e7);
    r.sun.position.set(-24, props.warmLight ? 24 : 42, 20);
    r.sun.intensity = props.warmLight ? 3.4 : 3;
    r.fill.intensity = props.warmLight ? 0.95 : 1.35;
    r.scene.environmentIntensity = props.warmLight ? 0.45 : 0.6;
    const background = props.warmLight ? 0xe8e4d9 : 0xe3eaf0;
    r.renderer.setClearColor(background);
    if (r.scene.fog instanceof THREE.Fog) r.scene.fog.color.set(background);
    r.render();
  }, [
    props.tables,
    props.selected,
    props.roof,
    props.dropPreview,
    props.warmLight,
  ]);

  return (
    <div
      ref={host}
      className="venue-render"
      role="group"
      aria-label="Interactive Benavento terrace. Use the table controls or floor plan for keyboard editing."
    >
      {!error && <div className="venue-viewpoints" aria-label="Camera views">
        {["Overview", "Guest view", "Garden"].map((name) => <button
          key={name} type="button" aria-pressed={view === name}
          onClick={() => changeView(name)}>{name}</button>)}
      </div>}
      {!error && <span className="venue-model-status" role="status">{modelStatus}</span>}
      {error && (
        <p className="venue-fallback">
          3D isn’t available on this device. Choose Floor plan to edit the same
          layout.
        </p>
      )}
    </div>
  );
}
