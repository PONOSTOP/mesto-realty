import { open } from "node:fs/promises";
import { z } from "zod";

export const MAX_SCENE_BYTES = 100 * 1024 * 1024;
const invalid = () =>
  Object.assign(new Error("Некорректный файл 3D-модели PLY"), { status: 422 });
const vector = z.tuple([
  z.number().finite().min(-1e6).max(1e6),
  z.number().finite().min(-1e6).max(1e6),
  z.number().finite().min(-1e6).max(1e6),
]);
const cameraSchema = z
  .object({ position: vector, target: vector, up: vector })
  .strict();
export function parseCamera(value) {
  let camera;
  try {
    camera = cameraSchema.parse(JSON.parse(value));
  } catch {
    throw invalid();
  }
  const d = camera.position.map((x, i) => x - camera.target[i]),
    u = camera.up;
  const cross = [
    d[1] * u[2] - d[2] * u[1],
    d[2] * u[0] - d[0] * u[2],
    d[0] * u[1] - d[1] * u[0],
  ];
  if (
    Math.hypot(...d) < 1e-6 ||
    Math.hypot(...u) < 1e-6 ||
    Math.hypot(...cross) < 1e-6
  )
    throw invalid();
  return camera;
}

// Only the scalar float vertex layout emitted by ns-export gaussian-splat.
// Validate the whole binary payload before any browser sees it.
export async function validateSceneFile(filename) {
  const file = await open(filename, "r");
  try {
    const stat = await file.stat();
    if (stat.size > MAX_SCENE_BYTES || stat.size < 100) throw invalid();
    const headerBuffer = Buffer.alloc(Math.min(16384, stat.size));
    await file.read(headerBuffer, 0, headerBuffer.length, 0);
    const end = headerBuffer.indexOf("end_header\n");
    if (end < 0) throw invalid();
    const offset = end + 11;
    const lines = headerBuffer.subarray(0, end).toString("ascii").split("\n");
    if (
      lines.shift() !== "ply" ||
      lines.shift() !== "format binary_little_endian 1.0"
    )
      throw invalid();
    let vertexCount = null,
      fields = [];
    for (const line of lines) {
      if (!line || line.startsWith("comment ")) continue;
      const element = /^element vertex ([1-9]\d*)$/.exec(line);
      if (element && vertexCount === null && fields.length === 0) {
        vertexCount = Number(element[1]);
        continue;
      }
      const prop = /^property float ([a-z0-9_]+)$/.exec(line);
      if (prop && vertexCount !== null) {
        fields.push(prop[1]);
        continue;
      }
      throw invalid();
    }
    const required = [
      "x",
      "y",
      "z",
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
    if (
      !Number.isSafeInteger(vertexCount) ||
      vertexCount > 1_000_000 ||
      new Set(fields).size !== fields.length ||
      fields.length > 80 ||
      required.some((x) => !fields.includes(x)) ||
      fields.some(
        (x) =>
          !/^(x|y|z|nx|ny|nz|f_dc_[0-2]|f_rest_\d+|opacity|scale_[0-2]|rot_[0-3])$/.test(
            x,
          ),
      ) ||
      stat.size !== offset + vertexCount * fields.length * 4
    )
      throw invalid();
    const chunk = Buffer.alloc(65536);
    for (let pos = offset; pos < stat.size;) {
      const { bytesRead } = await file.read(
        chunk,
        0,
        Math.min(chunk.length, stat.size - pos),
        pos,
      );
      if (!bytesRead || bytesRead % 4) throw invalid();
      for (let i = 0; i < bytesRead; i += 4)
        if (!Number.isFinite(chunk.readFloatLE(i))) throw invalid();
      pos += bytesRead;
    }
    return { vertexCount };
  } finally {
    await file.close();
  }
}
