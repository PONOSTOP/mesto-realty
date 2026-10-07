import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArchitecturalScene } from "../public/js/architectural-schema.js";
export const room = () => ({
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
      tone: "neutral",
    },
  ],
  walls: [
    {
      id: "north",
      start: [0, 0],
      end: [12, 0],
      thickness: 0.15,
      exterior: true,
    },
  ],
  openings: [
    {
      wallId: "north",
      kind: "window",
      offset: 2,
      width: 1.5,
      bottom: 0.9,
      height: 1.5,
    },
  ],
  columns: [{ position: [6, 4], width: 0.4, depth: 0.4, height: 3 }],
  furniture: [
    {
      kind: "sofa",
      position: [4, 2],
      width: 2,
      depth: 0.8,
      height: 0.8,
      rotation: 0,
    },
  ],
  warnings: ["Размеры мебели приблизительные"],
});
test("dimensioned architectural scene preserves valid metric geometry", () => {
  assert.deepEqual(
    parseArchitecturalScene(room(), { width: 12, depth: 8, height: 3 }),
    room(),
  );
});
test("invalid topology, scale, external content and excessive objects are rejected", () => {
  const invalid = [];
  invalid.push(
    { ...room(), width: Infinity },
    { ...room(), texture: "https://example.com/x" },
    { ...room(), walls: [{ ...room().walls[0], end: [0, 0] }] },
  );
  invalid.push(
    { ...room(), openings: [{ ...room().openings[0], wallId: "unknown" }] },
    { ...room(), openings: [{ ...room().openings[0], offset: 11 }] },
    { ...room(), openings: [{ ...room().openings[0], bottom: 2 }] },
  );
  invalid.push(
    { ...room(), furniture: [{ ...room().furniture[0], kind: "script" }] },
    { ...room(), furniture: [{ ...room().furniture[0], position: [0, 0] }] },
    { ...room(), columns: Array(301).fill(room().columns[0]) },
  );
  invalid.push({
    ...room(),
    floors: [
      {
        points: [
          [0, 0],
          [12, 8],
          [12, 0],
          [0, 8],
        ],
        tone: "neutral",
      },
    ],
  });
  for (const scene of invalid)
    assert.throws(() => parseArchitecturalScene(scene));
  assert.throws(() =>
    parseArchitecturalScene(room(), { width: 10, depth: 8, height: 3 }),
  );
});
test("overlapping wall openings are rejected while vertical separation is valid", () => {
  const scene = room();
  scene.openings.push({ ...scene.openings[0], offset: 2.5 });
  assert.throws(() => parseArchitecturalScene(scene));
  scene.openings[1] = {
    ...scene.openings[0],
    offset: 2.5,
    bottom: 2.5,
    height: 0.4,
  };
  assert.equal(parseArchitecturalScene(scene).openings.length, 2);
});
