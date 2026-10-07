import * as THREE from "three";

// Rectangular cells partition the wall face; openings contain no wall mesh.
export function wallRectangles(wall, openings, height) {
  const length = Math.hypot(
    wall.end[0] - wall.start[0],
    wall.end[1] - wall.start[1],
  );
  const holes = openings.filter((o) => o.wallId === wall.id);
  let rectangles = [{ left: 0, right: length, bottom: 0, top: height }];
  for (const hole of holes) {
    const next = [];
    for (const rect of rectangles) {
      const left = Math.max(rect.left, hole.offset),
        right = Math.min(rect.right, hole.offset + hole.width),
        bottom = Math.max(rect.bottom, hole.bottom),
        top = Math.min(rect.top, hole.bottom + hole.height);
      if (left >= right || bottom >= top) {
        next.push(rect);
        continue;
      }
      if (rect.left < left) next.push({ ...rect, right: left });
      if (rect.right > right) next.push({ ...rect, left: right });
      if (rect.bottom < bottom)
        next.push({ left, right, bottom: rect.bottom, top: bottom });
      if (rect.top > top)
        next.push({ left, right, bottom: top, top: rect.top });
    }
    rectangles = next;
  }
  return rectangles;
}

export function pointInFloor(point, points) {
  const [x, z] = point;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i],
      [xj, zj] = points[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      inside = !inside;
  }
  return inside;
}

export function canStandAt(scene, point, radius = 0.18) {
  if (
    ![
      [0, 0],
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
    ].every(([dx, dz]) =>
      scene.floors.some((f) =>
        pointInFloor([point[0] + dx, point[1] + dz], f.points),
      ),
    )
  )
    return false;
  for (const wall of scene.walls) {
    const dx = wall.end[0] - wall.start[0],
      dz = wall.end[1] - wall.start[1],
      length = Math.hypot(dx, dz);
    const offset =
      ((point[0] - wall.start[0]) * dx + (point[1] - wall.start[1]) * dz) /
      length;
    const nearest = Math.max(0, Math.min(length, offset));
    const distance = Math.hypot(
      point[0] - wall.start[0] - (dx * nearest) / length,
      point[1] - wall.start[1] - (dz * nearest) / length,
    );
    if (distance < wall.thickness / 2 + radius) {
      const passage = scene.openings.some(
        (o) =>
          o.wallId === wall.id &&
          o.kind === "door" &&
          o.bottom <= 0.05 &&
          o.height >= Math.min(1.7, scene.height * 0.8) &&
          offset >= o.offset + radius &&
          offset <= o.offset + o.width - radius,
      );
      if (!passage) return false;
    }
  }
  for (const column of scene.columns)
    if (
      Math.abs(point[0] - column.position[0]) < column.width / 2 + radius &&
      Math.abs(point[1] - column.position[1]) < column.depth / 2 + radius
    )
      return false;
  for (const item of scene.furniture) {
    const angle = -item.rotation,
      dx = point[0] - item.position[0],
      dz = point[1] - item.position[1];
    const x = dx * Math.cos(angle) - dz * Math.sin(angle),
      z = dx * Math.sin(angle) + dz * Math.cos(angle);
    if (
      Math.abs(x) < item.width / 2 + radius &&
      Math.abs(z) < item.depth / 2 + radius
    )
      return false;
  }
  return true;
}

export function findInteriorStart(scene) {
  const center = [scene.width / 2, scene.depth / 2];
  if (canStandAt(scene, center)) return center;
  const candidates = [];
  const step = Math.max(0.15, Math.min(scene.width, scene.depth) / 40);
  for (let x = step; x < scene.width; x += step)
    for (let z = step; z < scene.depth; z += step) {
      if (canStandAt(scene, [x, z])) candidates.push([x, z]);
    }
  candidates.sort(
    (a, b) =>
      Math.hypot(a[0] - center[0], a[1] - center[1]) -
      Math.hypot(b[0] - center[0], b[1] - center[1]),
  );
  if (!candidates.length)
    throw new Error("В помещении нет свободного места для просмотра изнутри.");
  return candidates[0];
}

export function moveWithinScene(scene, start, delta) {
  let point = [...start];
  const steps = Math.max(1, Math.ceil(Math.hypot(...delta) / 0.06));
  for (let i = 0; i < steps; i++) {
    const x = [point[0] + delta[0] / steps, point[1]];
    if (canStandAt(scene, x)) point = x;
    const z = [point[0], point[1] + delta[1] / steps];
    if (canStandAt(scene, z)) point = z;
  }
  return point;
}

export function buildArchitecturalGeometry(scene) {
  const group = new THREE.Group();
  group.name = "architecture";
  const white = new THREE.MeshStandardMaterial({
    color: 0xf8f8f5,
    roughness: 0.78,
  });
  const fabric = new THREE.MeshStandardMaterial({
    color: 0xe7e5e0,
    roughness: 0.95,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: 0xd7ddd9,
    roughness: 0.65,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0xc5dce1,
    transparent: true,
    opacity: 0.3,
    roughness: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ceilings = new THREE.Group();
  ceilings.name = "ceilings";
  ceilings.visible = false;
  group.add(ceilings);
  function box(parent, w, h, d, x, y, z, material = white, name = "") {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  scene.floors.forEach((floor, i) => {
    const shape = new THREE.Shape(
      floor.points.map(([x, z]) => new THREE.Vector2(x, -z)),
    );
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: floor.tone === "warm" ? 0xe0d5c4 : 0xe4e5e0,
        side: THREE.DoubleSide,
        roughness: 0.9,
      }),
    );
    mesh.name = "floor-" + i;
    mesh.receiveShadow = true;
    group.add(mesh);
    const ceiling = new THREE.Mesh(geometry, white);
    ceiling.position.y = scene.height;
    ceilings.add(ceiling);
  });
  scene.walls.forEach((wall) => {
    const dx = wall.end[0] - wall.start[0],
      dz = wall.end[1] - wall.start[1],
      angle = Math.atan2(dz, dx),
      length = Math.hypot(dx, dz);
    const wallGroup = new THREE.Group();
    wallGroup.name = "wall-" + wall.id;
    wallGroup.position.set(wall.start[0], 0, wall.start[1]);
    wallGroup.rotation.y = -angle;
    group.add(wallGroup);
    wallRectangles(wall, scene.openings, scene.height).forEach((r) =>
      box(
        wallGroup,
        r.right - r.left,
        r.top - r.bottom,
        wall.thickness,
        (r.left + r.right) / 2,
        (r.bottom + r.top) / 2,
        0,
      ),
    );
    scene.openings.forEach((o, index) => {
      if (o.wallId !== wall.id) return;
      const frame = Math.min(0.055, o.width / 10, o.height / 10),
        thickness = wall.thickness + 0.025;
      const x = o.offset + o.width / 2,
        y = o.bottom + o.height / 2;
      box(
        wallGroup,
        frame,
        o.height,
        thickness,
        o.offset + frame / 2,
        y,
        0,
        trim,
      );
      box(
        wallGroup,
        frame,
        o.height,
        thickness,
        o.offset + o.width - frame / 2,
        y,
        0,
        trim,
      );
      box(
        wallGroup,
        o.width,
        frame,
        thickness,
        x,
        o.bottom + o.height - frame / 2,
        0,
        trim,
      );
      if (o.kind === "window") {
        box(
          wallGroup,
          o.width,
          frame,
          thickness,
          x,
          o.bottom + frame / 2,
          0,
          trim,
        );
        box(wallGroup, frame, o.height, thickness, x, y, 0, trim);
        box(
          wallGroup,
          o.width - frame * 2,
          o.height - frame * 2,
          0.012,
          x,
          y,
          0,
          glass,
          "window-glass-" + index,
        );
      }
    });
    wallGroup.userData.length = length;
  });
  scene.columns.forEach((c, i) =>
    box(
      group,
      c.width,
      c.height,
      c.depth,
      c.position[0],
      c.height / 2,
      c.position[1],
      white,
      "column-" + i,
    ),
  );
  scene.furniture.forEach((item, i) => {
    const object = new THREE.Group();
    object.name = "furniture-" + i;
    object.position.set(item.position[0], 0, item.position[1]);
    object.rotation.y = -item.rotation;
    group.add(object);
    const { width: w, depth: d, height: h, kind } = item;
    const part = (pw, ph, pd, x, y, z, mat = white) =>
      box(object, pw * w, ph * h, pd * d, x * w, y * h, z * d, mat);
    const legs = () => {
      for (const x of [-0.42, 0.42])
        for (const z of [-0.4, 0.4]) part(0.08, 0.68, 0.08, x, 0.34, z, trim);
    };
    if (["sofa", "armchair"].includes(kind)) {
      part(1, 0.18, 1, 0, 0.18, 0);
      part(0.8, 0.28, 0.78, 0, 0.4, 0.07, fabric);
      part(1, 0.7, 0.18, 0, 0.65, -0.41, fabric);
      for (const x of [-0.44, 0.44]) part(0.12, 0.62, 1, x, 0.46, 0, fabric);
    } else if (["table", "desk", "chair"].includes(kind)) {
      legs();
      part(1, 0.12, 1, 0, kind === "chair" ? 0.5 : 0.88, 0);
      if (kind === "chair") part(1, 0.45, 0.1, 0, 0.775, -0.45);
      else part(0.25, 0.16, 0.25, 0, 0.08, 0, trim);
    } else if (kind === "bed") {
      part(1, 0.22, 1, 0, 0.11, 0);
      part(0.94, 0.3, 0.92, 0, 0.37, 0, fabric);
      part(1, 1, 0.08, 0, 0.5, -0.46);
      for (const x of [-0.24, 0.24])
        part(0.4, 0.12, 0.22, x, 0.58, -0.3, white);
    } else if (["cabinet", "kitchen", "shelf"].includes(kind)) {
      part(1, 0.06, 1, 0, 0.03, 0);
      part(1, 0.06, 1, 0, 0.97, 0);
      part(0.06, 1, 1, -0.47, 0.5, 0);
      part(0.06, 1, 1, 0.47, 0.5, 0);
      part(1, 1, 0.06, 0, 0.5, -0.47);
      if (kind === "shelf")
        for (const y of [0.3, 0.6]) part(1, 0.04, 1, 0, y, 0);
      else {
        part(0.94, 0.88, 0.04, 0, 0.5, 0.46, fabric);
        part(0.02, 0.88, 0.025, 0, 0.5, 0.485, trim);
      }
    } else if (kind === "sink") {
      part(0.7, 0.7, 0.8, 0, 0.35, 0);
      part(1, 0.12, 1, 0, 0.76, 0);
      part(0.62, 0.025, 0.58, 0, 0.825, 0, trim);
      part(0.06, 0.18, 0.05, 0, 0.91, -0.36, trim);
    } else if (kind === "toilet") {
      part(0.6, 0.55, 0.7, 0, 0.275, 0.1);
      part(1, 0.15, 0.85, 0, 0.625, 0.075);
      part(0.8, 1, 0.15, 0, 0.5, -0.425);
      part(0.62, 0.025, 0.52, 0, 0.71, 0.13, trim);
    }
  });
  return group;
}
