import { furnitureKinds } from "../public/js/architectural-schema.js";
// Constrain local vision decoding; canonical validation still checks topology.
export function architecturalJsonSchema({ width, depth, height }) {
  const number = (minimum, maximum) => ({ type: "number", minimum, maximum });
  const obj = (properties) => ({
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  });
  const list = (items, maxItems, minItems = 0) => ({
    type: "array",
    items,
    minItems,
    maxItems,
  });
  const point = {
    type: "array",
    items: number(0, Math.max(width, depth)),
    minItems: 2,
    maxItems: 2,
  };
  const footprint = {
    position: point,
    width: number(0.05, width),
    depth: number(0.05, depth),
    height: number(0.05, height),
  };
  const scene = obj({
    version: { const: 1 },
    width: { const: width },
    depth: { const: depth },
    height: { const: height },
    floors: list(
      obj({ points: list(point, 500, 3), tone: { enum: ["neutral", "warm"] } }),
      100,
      1,
    ),
    walls: list(
      obj({
        id: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,40}$" },
        start: point,
        end: point,
        thickness: number(0.03, 1),
        exterior: { type: "boolean" },
      }),
      500,
      1,
    ),
    openings: list(
      obj({
        wallId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,40}$" },
        kind: { enum: ["window", "door"] },
        offset: number(0, Math.hypot(width, depth)),
        width: number(0.1, Math.hypot(width, depth)),
        bottom: number(0, height),
        height: number(0.1, height),
      }),
      500,
    ),
    columns: list(obj({ ...footprint, height: number(0.1, height) }), 300),
    furniture: list(
      obj({
        kind: { enum: furnitureKinds },
        ...footprint,
        rotation: number(-2 * Math.PI, 2 * Math.PI),
      }),
      300,
    ),
    warnings: list(
      {
        type: "string",
        enum: [
          "Размеры мебели приблизительные",
          "Часть деталей не удалось определить по исходным данным",
        ],
      },
      2,
    ),
  });
  return { anyOf: [scene, obj({ error: { const: "unreadable_plan" } })] };
}
