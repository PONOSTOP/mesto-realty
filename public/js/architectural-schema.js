const bad = () =>
  Object.assign(new Error("Не удалось проверить геометрию планировки"), {
    code: "invalid_layout",
    status: 422,
  });
const requireValue = (condition) => {
  if (!condition) throw bad();
};
const number = (value, min, max) => {
  requireValue(
    typeof value === "number" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max,
  );
  return value;
};
const object = (value, keys) => {
  requireValue(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  requireValue(Object.keys(value).every((key) => keys.includes(key)));
  requireValue(keys.every((key) => Object.hasOwn(value, key)));
};
const list = (value, max, min = 0) => {
  requireValue(
    Array.isArray(value) && value.length >= min && value.length <= max,
  );
};
const text = (value, max) => {
  requireValue(typeof value === "string" && value.length <= max);
};
const cross = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const between = (p, a, b) =>
  Math.abs(cross(a, b, p)) < 1e-8 &&
  p[0] >= Math.min(a[0], b[0]) - 1e-8 &&
  p[0] <= Math.max(a[0], b[0]) + 1e-8 &&
  p[1] >= Math.min(a[1], b[1]) - 1e-8 &&
  p[1] <= Math.max(a[1], b[1]) + 1e-8;
function intersects(a, b, c, d) {
  const x = cross(a, b, c),
    y = cross(a, b, d),
    z = cross(c, d, a),
    t = cross(c, d, b);
  return (
    (x * y < 0 && z * t < 0) ||
    between(c, a, b) ||
    between(d, a, b) ||
    between(a, c, d) ||
    between(b, c, d)
  );
}
export const furnitureKinds = [
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
];
export function parseArchitecturalScene(value, expectedDimensions) {
  object(value, [
    "version",
    "width",
    "depth",
    "height",
    "floors",
    "walls",
    "openings",
    "columns",
    "furniture",
    "warnings",
  ]);
  requireValue(value.version === 1);
  const width = number(value.width, 0.1, 200),
    depth = number(value.depth, 0.1, 200),
    height = number(value.height, 0.5, 50);
  if (expectedDimensions)
    for (const key of ["width", "depth", "height"])
      requireValue(Math.abs(value[key] - expectedDimensions[key]) < 0.01);
  requireValue(JSON.stringify(value).length <= 1_000_000);
  const point = (p) => {
    list(p, 2, 2);
    number(p[0], -0.001, width + 0.001);
    number(p[1], -0.001, depth + 0.001);
  };
  const footprint = (p, w, d, rotation = 0) => {
    point(p);
    number(w, 0.02, width);
    number(d, 0.02, depth);
    const c = Math.cos(rotation),
      s = Math.sin(rotation);
    for (const x of [-w / 2, w / 2])
      for (const z of [-d / 2, d / 2])
        point([p[0] + x * c - z * s, p[1] + x * s + z * c]);
  };
  list(value.floors, 100, 1);
  let vertices = 0;
  for (const floor of value.floors) {
    object(floor, ["points", "tone"]);
    requireValue(["neutral", "warm"].includes(floor.tone));
    list(floor.points, 500, 3);
    vertices += floor.points.length;
    requireValue(vertices <= 2000);
    for (const p of floor.points) point(p);
    let area = 0;
    const n = floor.points.length;
    for (let i = 0; i < n; i++) {
      const a = floor.points[i],
        b = floor.points[(i + 1) % n];
      requireValue(Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.001);
      area += a[0] * b[1] - a[1] * b[0];
      for (let j = i + 1; j < n; j++) {
        if (j === i + 1 || (i === 0 && j === n - 1)) continue;
        requireValue(
          !intersects(a, b, floor.points[j], floor.points[(j + 1) % n]),
        );
      }
    }
    requireValue(Math.abs(area) > 0.02);
  }
  list(value.walls, 500, 1);
  const walls = new Map();
  for (const wall of value.walls) {
    object(wall, ["id", "start", "end", "thickness", "exterior"]);
    text(wall.id, 40);
    requireValue(/^[a-zA-Z0-9_-]{1,40}$/.test(wall.id) && !walls.has(wall.id));
    point(wall.start);
    point(wall.end);
    number(wall.thickness, 0.03, 1);
    requireValue(typeof wall.exterior === "boolean");
    const length = Math.hypot(
      wall.end[0] - wall.start[0],
      wall.end[1] - wall.start[1],
    );
    requireValue(length >= 0.05);
    walls.set(wall.id, { length, openings: [] });
  }
  list(value.openings, 500);
  for (const opening of value.openings) {
    object(opening, ["wallId", "kind", "offset", "width", "bottom", "height"]);
    const wall = walls.get(opening.wallId);
    requireValue(!!wall && ["door", "window"].includes(opening.kind));
    number(opening.offset, 0, wall.length);
    number(opening.width, 0.1, wall.length);
    number(opening.bottom, 0, height);
    number(opening.height, 0.1, height);
    requireValue(
      opening.offset + opening.width <= wall.length + 0.001 &&
        opening.bottom + opening.height <= height + 0.001,
    );
    requireValue(opening.kind !== "door" || opening.bottom === 0);
    for (const other of wall.openings)
      requireValue(
        opening.offset + opening.width <= other.offset + 0.001 ||
          other.offset + other.width <= opening.offset + 0.001 ||
          opening.bottom + opening.height <= other.bottom + 0.001 ||
          other.bottom + other.height <= opening.bottom + 0.001,
      );
    wall.openings.push(opening);
  }
  list(value.columns, 300);
  for (const column of value.columns) {
    object(column, ["position", "width", "depth", "height"]);
    footprint(column.position, column.width, column.depth);
    number(column.height, 0.1, height);
  }
  list(value.furniture, 300);
  for (const item of value.furniture) {
    object(item, ["kind", "position", "width", "depth", "height", "rotation"]);
    requireValue(furnitureKinds.includes(item.kind));
    number(item.rotation, -Math.PI * 2, Math.PI * 2);
    footprint(item.position, item.width, item.depth, item.rotation);
    number(item.height, 0.05, height);
  }
  list(value.warnings, 20);
  for (const warning of value.warnings) text(warning, 300);
  return value;
}
