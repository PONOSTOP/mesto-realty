import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  buildArchitecturalGeometry,
  wallRectangles,
  canStandAt,
  findInteriorStart,
  moveWithinScene,
} from "../public/js/architectural-geometry.js";

export const plan = {
  version: 1,
  width: 12,
  depth: 8,
  height: 3,
  floors: [
    {
      points: [
        [0, 0],
        [12, 0],
        [12, 8],
        [0, 8],
      ],
      tone: "warm",
    },
  ],
  walls: [
    {
      id: "south",
      start: [0, 0],
      end: [12, 0],
      thickness: 0.2,
      exterior: true,
    },
    {
      id: "partition",
      start: [6, 0],
      end: [6, 8],
      thickness: 0.2,
      exterior: false,
    },
  ],
  openings: [
    {
      wallId: "south",
      kind: "window",
      offset: 2,
      width: 2,
      bottom: 1,
      height: 1.5,
    },
    {
      wallId: "partition",
      kind: "door",
      offset: 3,
      width: 1,
      bottom: 0,
      height: 2.2,
    },
  ],
  columns: [{ position: [3, 4], width: 0.4, depth: 0.4, height: 3 }],
  furniture: [
    {
      kind: "sofa",
      position: [3, 2],
      width: 2,
      depth: 0.8,
      height: 0.8,
      rotation: 0,
    },
  ],
  warnings: [],
};

test("wall solids subtract windows and doors rather than cover them", () => {
  const solids = wallRectangles(plan.walls[0], plan.openings, 3);
  const area = solids.reduce(
    (sum, r) => sum + (r.right - r.left) * (r.top - r.bottom),
    0,
  );
  assert.equal(area, 33);
  assert.equal(
    solids.some(
      (r) => r.left < 3 && r.right > 3 && r.bottom < 1.75 && r.top > 1.75,
    ),
    false,
  );
  const door = wallRectangles(plan.walls[1], plan.openings, 3);
  assert.equal(
    door.some(
      (r) => r.left < 3.5 && r.right > 3.5 && r.bottom < 1 && r.top > 1,
    ),
    false,
  );
});

test("polygon floors preserve measured dimensions and furniture has recognizable parts", () => {
  const model = buildArchitecturalGeometry(plan);
  const floor = model.getObjectByName("floor-0");
  const box = new THREE.Box3().setFromObject(floor);
  assert.equal(box.max.x - box.min.x, 12);
  assert.equal(box.max.z - box.min.z, 8);
  assert.equal(model.getObjectByName("furniture-0").children.length >= 5, true);
  assert.ok(model.getObjectByName("window-glass-0"));
  assert.ok(model.getObjectByName("column-0"));
  assert.ok(model.getObjectByName("ceilings"));
});

test("interior start avoids walls and columns and walking cannot tunnel through walls", () => {
  const start = findInteriorStart(plan);
  assert.equal(canStandAt(plan, start), true);
  assert.equal(canStandAt(plan, [6, 2]), false);
  assert.equal(canStandAt(plan, [3, 4]), false);
  assert.equal(canStandAt(plan, [6, 3.5]), true);
  assert.equal(canStandAt(plan, [20, 2]), false);
  const moved = moveWithinScene(plan, [5, 2], [3, 0]);
  assert.ok(moved[0] < 5.9);
  const throughDoor = moveWithinScene(plan, [5, 3.5], [2, 0]);
  assert.ok(throughDoor[0] > 6.5);
});

test("all allowed furniture kinds have bounded multi-part geometry", () => {
  for (const kind of [
    "sofa",
    "armchair",
    "table",
    "chair",
    "bed",
    "cabinet",
    "kitchen",
    "sink",
    "toilet",
    "desk",
    "shelf",
  ]) {
    const model = buildArchitecturalGeometry({
      ...plan,
      furniture: [{ ...plan.furniture[0], kind }],
    });
    const furniture = model.getObjectByName("furniture-0");
    assert.ok(furniture.children.length >= 2, kind);
    const size = new THREE.Box3()
      .setFromObject(furniture)
      .getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x - 2) < 0.001, kind);
    assert.ok(Math.abs(size.z - 0.8) < 0.001, kind);
    assert.ok(size.y <= 0.801, kind);
  }
});

test("walking crosses adjacent floor polygons through a doorway", () => {
  const scene = {
    ...plan,
    floors: [
      {
        points: [
          [0, 0],
          [6, 0],
          [6, 8],
          [0, 8],
        ],
        tone: "neutral",
      },
      {
        points: [
          [6, 0],
          [12, 0],
          [12, 8],
          [6, 8],
        ],
        tone: "neutral",
      },
    ],
  };
  assert.equal(canStandAt(scene, [6, 3.5]), true);
  assert.ok(moveWithinScene(scene, [5, 3.5], [2, 0])[0] > 6.5);
});

test("furniture rotation is expressed in radians", () => {
  const model = buildArchitecturalGeometry({
    ...plan,
    furniture: [{ ...plan.furniture[0], rotation: Math.PI / 2 }],
  });
  const size = new THREE.Box3()
    .setFromObject(model.getObjectByName("furniture-0"))
    .getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - 0.8) < 0.001);
  assert.ok(Math.abs(size.z - 2) < 0.001);
});

test("many staggered openings do not multiply wall meshes into a full grid", () => {
  const wall = {
    id: "long",
    start: [0, 0],
    end: [200, 0],
    thickness: 0.2,
    exterior: true,
  };
  const holes = Array.from({ length: 100 }, (_, i) => ({
    wallId: "long",
    kind: "window",
    offset: i * 1.5 + 0.2,
    width: 0.5,
    bottom: 0.5 + i * 0.005,
    height: 0.3,
  }));
  const rectangles = wallRectangles(wall, holes, 3);
  assert.ok(rectangles.length <= holes.length * 4 + 1);
  const area = rectangles.reduce(
    (sum, r) => sum + (r.right - r.left) * (r.top - r.bottom),
    0,
  );
  assert.ok(Math.abs(area - 585) < 0.001);
});
