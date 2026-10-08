import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { parseArchitecturalScene } from "./architectural-schema.js";
import {
  buildArchitecturalGeometry,
  findInteriorStart,
  moveWithinScene,
} from "./architectural-geometry.js";

export function createArchitecturalViewer(host, value) {
  const sceneData = parseArchitecturalScene(value);
  const world = new THREE.Scene();
  world.background = new THREE.Color(0xf5f7f8);
  const model = buildArchitecturalGeometry(sceneData);
  world.add(model);
  world.add(new THREE.HemisphereLight(0xffffff, 0xe8edf0, 2.2));
  world.add(new THREE.AmbientLight(0xffffff, 0.65));
  const sun = new THREE.DirectionalLight(0xfffaf2, 2.2);
  sun.position.set(
    -sceneData.width * 0.3,
    sceneData.height + sceneData.depth,
    sceneData.depth * 1.2,
  );
  sun.target.position.set(sceneData.width / 2, 0, sceneData.depth / 2);
  sun.castShadow = true;
  const extent = Math.max(sceneData.width, sceneData.depth);
  Object.assign(sun.shadow.camera, {
    left: -extent,
    right: extent,
    top: extent,
    bottom: -extent,
    near: 0.1,
    far: extent * 5 + sceneData.height,
  });
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  world.add(sun, sun.target);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(sceneData.width * 4, sceneData.depth * 4),
    new THREE.MeshStandardMaterial({ color: 0xf4f5f6, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(sceneData.width / 2, -0.025, sceneData.depth / 2);
  world.add(ground);
  const camera = new THREE.PerspectiveCamera(
    48,
    1,
    0.03,
    Math.max(sceneData.width, sceneData.depth) * 20 + sceneData.height,
  );
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.minDistance = 0.8;
  controls.maxDistance = Math.max(sceneData.width, sceneData.depth) * 5;
  let mode = "top",
    disposed = false,
    frame,
    lastTime = 0,
    yaw = 0,
    pitch = 0,
    drag;
  const held = new Set();
  const eyeHeight = Math.min(1.65, sceneData.height * 0.65);
  function look() {
    camera.lookAt(
      camera.position.x + Math.sin(yaw) * Math.cos(pitch),
      camera.position.y + Math.sin(pitch),
      camera.position.z - Math.cos(yaw) * Math.cos(pitch),
    );
  }
  function fitTop() {
    controls.target.set(sceneData.width / 2, 0, sceneData.depth / 2);
    const radius =
      Math.hypot(sceneData.width, sceneData.depth, sceneData.height) / 2;
    const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = (radius / Math.sin(Math.min(vertical, horizontal))) * 1.16;
    camera.position
      .copy(controls.target)
      .add(
        new THREE.Vector3(0.28, 1.6, 0.4).normalize().multiplyScalar(distance),
      );
    controls.update();
  }
  function reset() {
    held.clear();
    if (mode === "top") fitTop();
    else {
      const [x, z] = findInteriorStart(sceneData);
      camera.position.set(x, eyeHeight, z);
      // Start by looking toward a visible window or furnishing, rather than
      // presenting a blank wall. Only measured scene objects are candidates.
      const targets = sceneData.openings
        .filter((opening) => opening.kind === "window")
        .map((opening) => {
          const wall = sceneData.walls.find(
            (item) => item.id === opening.wallId,
          );
          const length = Math.hypot(
            wall.end[0] - wall.start[0],
            wall.end[1] - wall.start[1],
          );
          const t = (opening.offset + opening.width / 2) / length;
          return new THREE.Vector3(
            wall.start[0] + (wall.end[0] - wall.start[0]) * t,
            opening.bottom + opening.height / 2,
            wall.start[1] + (wall.end[1] - wall.start[1]) * t,
          );
        });
      targets.push(
        ...sceneData.furniture.map(
          (item) =>
            new THREE.Vector3(
              item.position[0],
              Math.min(eyeHeight, item.height / 2),
              item.position[1],
            ),
        ),
      );
      const wallMeshes = model.children.filter((item) =>
        item.name.startsWith("wall-"),
      );
      const ray = new THREE.Raycaster();
      world.updateMatrixWorld(true);
      const target = targets.find((point) => {
        const offset = point.clone().sub(camera.position);
        const distance = offset.length();
        ray.set(camera.position, offset.normalize());
        const hit = ray.intersectObjects(wallMeshes, true)[0];
        return !hit || hit.distance >= distance - 0.2;
      });
      yaw = target ? Math.atan2(target.x - x, -(target.z - z)) : Math.PI;
      pitch = target
        ? Math.atan2(
            target.y - eyeHeight,
            Math.hypot(target.x - x, target.z - z),
          )
        : 0;
      look();
    }
  }
  function setMode(next) {
    if (disposed) return;
    if (!["top", "inside"].includes(next)) throw new Error("Unknown view mode");
    if (next === "inside") findInteriorStart(sceneData);
    mode = next;
    camera.fov = mode === "inside" ? 68 : 48;
    camera.updateProjectionMatrix();
    host.dataset.mode = mode;
    controls.enabled = mode === "top";
    model.getObjectByName("ceilings").visible = mode === "inside";
    reset();
  }
  function move(direction, amount) {
    if (mode !== "inside" || disposed) return;
    if (direction === "left" || direction === "right") {
      yaw += (direction === "left" ? -1 : 1) * amount;
      look();
      return;
    }
    const sign = direction === "backward" ? -1 : 1;
    const next = moveWithinScene(
      sceneData,
      [camera.position.x, camera.position.z],
      [Math.sin(yaw) * amount * sign, -Math.cos(yaw) * amount * sign],
    );
    camera.position.set(next[0], eyeHeight, next[1]);
    look();
  }
  function keydown(event) {
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "w",
        "a",
        "s",
        "d",
        "W",
        "A",
        "S",
        "D",
        "r",
        "R",
        "+",
        "=",
        "-",
      ].includes(event.key)
    ) {
      event.preventDefault();
      if (event.key.toLowerCase() === "r") reset();
      else if (mode === "inside") held.add(event.key.toLowerCase());
      else {
        const offset = camera.position.clone().sub(controls.target);
        if (["+", "=", "-"].includes(event.key))
          offset.multiplyScalar(event.key === "-" ? 1.12 : 0.88);
        else if (event.key.startsWith("Arrow"))
          offset.applyAxisAngle(
            event.key === "ArrowLeft" || event.key === "ArrowRight"
              ? new THREE.Vector3(0, 1, 0)
              : offset.clone().cross(camera.up).normalize(),
            ["ArrowLeft", "ArrowUp"].includes(event.key) ? 0.08 : -0.08,
          );
        camera.position.copy(controls.target).add(offset);
        controls.update();
      }
    }
  }
  const keyup = (event) => held.delete(event.key.toLowerCase());
  const clearHeld = () => held.clear();
  function pointerdown(event) {
    if (mode !== "inside") return;
    drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
    renderer.domElement.setPointerCapture(event.pointerId);
    host.focus();
  }
  function pointermove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    yaw -= (event.clientX - drag.x) * 0.006;
    pitch = Math.max(
      -1.1,
      Math.min(1.1, pitch - (event.clientY - drag.y) * 0.006),
    );
    drag.x = event.clientX;
    drag.y = event.clientY;
    look();
  }
  const pointerup = () => {
    drag = null;
  };
  const walkButtons = [
    ...(host.closest(".architectural-stage")?.querySelectorAll("[data-walk]") ||
      []),
  ];
  const walkers = [];
  for (const button of walkButtons) {
    const down = (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      held.add(button.dataset.walk);
    };
    const up = () => held.delete(button.dataset.walk);
    const click = () =>
      move(
        button.dataset.walk,
        button.dataset.walk === "left" || button.dataset.walk === "right"
          ? 0.2
          : 0.3,
      );
    button.addEventListener("pointerdown", down);
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up);
    button.addEventListener("lostpointercapture", up);
    button.addEventListener("click", click);
    walkers.push([button, down, up, click]);
  }
  host.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", clearHeld);
  renderer.domElement.addEventListener("pointerdown", pointerdown);
  renderer.domElement.addEventListener("pointermove", pointermove);
  renderer.domElement.addEventListener("pointerup", pointerup);
  renderer.domElement.addEventListener("pointercancel", pointerup);
  function resize() {
    if (disposed) return;
    const w = Math.max(1, host.clientWidth),
      h = Math.max(1, host.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    if (mode === "top") fitTop();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  setMode("top");
  function animate(time) {
    if (disposed) return;
    const dt = Math.min(0.05, (time - lastTime) / 1000 || 0);
    lastTime = time;
    if (mode === "top") controls.update();
    else {
      if (["w", "arrowup", "forward"].some((k) => held.has(k)))
        move("forward", dt * 2);
      if (["s", "arrowdown", "backward"].some((k) => held.has(k)))
        move("backward", dt * 2);
      if (["a", "arrowleft", "left"].some((k) => held.has(k)))
        move("left", dt * 1.3);
      if (["d", "arrowright", "right"].some((k) => held.has(k)))
        move("right", dt * 1.3);
    }
    renderer.render(world, camera);
    frame = requestAnimationFrame(animate);
  }
  frame = requestAnimationFrame(animate);
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    controls.dispose();
    host.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    window.removeEventListener("blur", clearHeld);
    for (const [button, down, up, click] of walkers) {
      button.removeEventListener("pointerdown", down);
      button.removeEventListener("pointerup", up);
      button.removeEventListener("pointercancel", up);
      button.removeEventListener("lostpointercapture", up);
      button.removeEventListener("click", click);
    }
    renderer.domElement.removeEventListener("pointerdown", pointerdown);
    renderer.domElement.removeEventListener("pointermove", pointermove);
    renderer.domElement.removeEventListener("pointerup", pointerup);
    renderer.domElement.removeEventListener("pointercancel", pointerup);
    const geometries = new Set(),
      materials = new Set();
    world.traverse((node) => {
      node.shadow?.dispose();
      if (node.geometry) geometries.add(node.geometry);
      if (node.material)
        for (const material of [].concat(node.material))
          materials.add(material);
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    held.clear();
    delete host.dataset.mode;
  }
  return { setMode, reset, dispose };
}
