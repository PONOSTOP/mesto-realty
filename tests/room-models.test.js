import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const fields = [
  "x",
  "y",
  "z",
  "nx",
  "ny",
  "nz",
  "f_dc_0",
  "f_dc_1",
  "f_dc_2",
  "opacity",
  "scale_0",
  "scale_1",
  "scale_2",
  "rot_0",
  "rot_1",
  "rot_2",
  "rot_3",
];
export function sceneFixture(count = 2) {
  const header = Buffer.from(
    `ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${fields.map((f) => `property float ${f}\n`).join("")}end_header\n`,
  );
  const body = Buffer.alloc(count * fields.length * 4);
  for (let i = 0; i < count; i++)
    body.writeFloatLE(1, (i * fields.length + 13) * 4);
  return Buffer.concat([header, body]);
}
test("binary gaussian scene accepts valid vertices but rejects malformed and non-finite data", async () => {
  const { validateSceneFile } =
    await import("../server/room-model-validation.js");
  const dir = await mkdtemp(path.join(os.tmpdir(), "room-ply-"));
  const file = path.join(dir, "scene.ply");
  try {
    await writeFile(file, sceneFixture());
    assert.equal((await validateSceneFile(file)).vertexCount, 2);
    await writeFile(file, Buffer.from("ply\nformat ascii 1.0\nend_header\n"));
    await assert.rejects(validateSceneFile(file), /модел|PLY/i);
    const bad = sceneFixture();
    bad.writeFloatLE(NaN, bad.length - 4);
    await writeFile(file, bad);
    await assert.rejects(validateSceneFile(file), /модел|PLY/i);
    await writeFile(file, sceneFixture().subarray(0, -1));
    await assert.rejects(validateSceneFile(file), /модел|PLY/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("camera rejects degenerate vectors, non-finite numbers and extra fields", async () => {
  const { parseCamera } = await import("../server/room-model-validation.js");
  const good = { position: [1, 2, 3], target: [0, 0, 0], up: [0, 1, 0] };
  assert.deepEqual(parseCamera(JSON.stringify(good)), good);
  for (const value of [
    { ...good, position: [0, 0, 0] },
    { ...good, up: [0, 0, 0] },
    { ...good, up: [1, 2, 3] },
    { ...good, position: [null, 2, 3] },
    { ...good, url: "https://bad" },
  ])
    assert.throws(() => parseCamera(JSON.stringify(value)));
});
