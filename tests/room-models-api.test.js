import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import sharp from "sharp";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Dedicated TEST_DATABASE_URL required");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.ROOM_MODEL_WORKER_TOKEN = "test-worker-token-".repeat(4);
process.env.ROOM_MODEL_MIN_PHOTOS = "2";
process.env.ROOM_MODEL_DEBOUNCE_SECONDS = "1";
const dir = await mkdtemp(path.join(os.tmpdir(), "room-api-"));
process.env.UPLOAD_DIR = dir;
const { createApp } = await import("../server/app.js");
const { pool } = await import("../server/db.js");
const { migrate } = await import("../server/migrate.js");
const instance = createApp(),
  app = instance.app,
  owner = request.agent(app);
const bearer = "Bearer " + process.env.ROOM_MODEL_WORKER_TOKEN;
const email = `room-${Date.now()}@example.com`;
let token, propertyId;
const png = await sharp({
  create: { width: 100, height: 100, channels: 3, background: "#777" },
})
  .png()
  .toBuffer();
const fields = [
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
const scene = Buffer.concat([
  Buffer.from(
    `ply\nformat binary_little_endian 1.0\nelement vertex 1\n${fields.map((f) => `property float ${f}\n`).join("")}end_header\n`,
  ),
  Buffer.alloc(fields.length * 4),
]);
const camera = { position: [1, 2, 3], target: [0, 0, 0], up: [0, 1, 0] };
const internal = (method, url) =>
  request(app)
    [method]("/internal/room-models" + url)
    .set("Authorization", bearer);
before(async () => {
  await migrate();
  token = (await owner.get("/api/auth/session")).body.csrfToken;
  token = (
    await owner
      .post("/api/auth/register")
      .set("X-CSRF-Token", token)
      .send({ name: "Владелец", email, password: "Long-password-123!" })
      .expect(201)
  ).body.csrfToken;
  propertyId = (
    await owner
      .post("/api/properties")
      .set("X-CSRF-Token", token)
      .send({
        title: "Офис для 3D теста",
        deal: "rent",
        category: "office",
        city: "Москва",
        address: "Тестовая улица 10",
        price: 10000,
        area: 30,
        description: "Помещение для проверки автоматической реконструкции.",
        contactName: "Владелец",
        contactPhone: "+79991234567",
        status: "draft",
      })
      .expect(201)
  ).body.property.id;
});
after(async () => {
  await pool.query("DELETE FROM users WHERE email=$1", [email]);
  instance.close();
  await pool.end();
  assert.equal(path.dirname(dir), os.tmpdir());
  await rm(dir, { recursive: true, force: true });
});
test("automatic queue lifecycle, stale workers and public model visibility", async () => {
  const base = "/api/properties/" + propertyId;
  await request(app)
    .get(base + "/model")
    .expect(404);
  await request(app).post("/internal/room-models/claim").send({}).expect(401);
  await request(app)
    .post("/internal/room-models/claim")
    .set(
      "Authorization",
      "Bearer " + "ÿ".repeat(process.env.ROOM_MODEL_WORKER_TOKEN.length),
    )
    .send({})
    .expect(401);
  await owner
    .post(base + "/images")
    .set("X-CSRF-Token", token)
    .attach("images", png, "one.png")
    .expect(201);
  assert.equal(
    (await owner.get(base + "/model").expect(200)).body.model.state,
    "needs_photos",
  );
  await owner
    .post(base + "/images")
    .set("X-CSRF-Token", token)
    .attach("images", png, "two.png")
    .expect(201);
  assert.equal((await owner.get(base + "/model")).body.model.state, "queued");
  assert.equal(
    (await internal("post", "/claim").send({}).expect(200)).body.job,
    null,
  );
  await pool.query(
    "UPDATE property_models SET available_at=now()-interval '1 minute' WHERE property_id=$1",
    [propertyId],
  );
  const first = (await internal("post", "/claim").send({}).expect(200)).body
    .job;
  assert.equal(first.propertyId, propertyId);
  assert.equal(first.images.length, 2);
  assert.equal((await internal("post", "/claim").send({})).body.job, null);
  const credentials = {
    revision: first.revision,
    leaseToken: first.leaseToken,
  };
  await internal("get", `/${propertyId}/images/${first.images[0].id}`)
    .set("X-Room-Model-Revision", String(first.revision))
    .set("X-Room-Model-Lease", first.leaseToken)
    .expect(200);
  await internal("post", `/${propertyId}/heartbeat`)
    .send(credentials)
    .expect(200);
  await owner
    .post(base + "/images")
    .set("X-CSRF-Token", token)
    .attach("images", png, "three.png")
    .expect(201);
  await internal("post", `/${propertyId}/heartbeat`)
    .send(credentials)
    .expect(409);
  await internal("post", `/${propertyId}/fail`)
    .send({ ...credentials, code: "reconstruction_failed" })
    .expect(409);
  await internal("post", `/${propertyId}/complete`)
    .field("revision", String(first.revision))
    .field("leaseToken", first.leaseToken)
    .field("camera", JSON.stringify(camera))
    .attach("scene", scene, "scene.ply")
    .expect(409);
  await pool.query(
    "UPDATE property_models SET available_at=now()-interval '1 minute' WHERE property_id=$1",
    [propertyId],
  );
  const job = (await internal("post", "/claim").send({})).body.job;
  await internal("post", `/${propertyId}/complete`)
    .field("revision", String(job.revision))
    .field("leaseToken", job.leaseToken)
    .field("camera", JSON.stringify(camera))
    .attach("scene", Buffer.from("fake"), "fake.ply")
    .expect(422);
  await internal("post", `/${propertyId}/complete`)
    .field("revision", String(job.revision))
    .field("leaseToken", job.leaseToken)
    .field("camera", JSON.stringify(camera))
    .attach("scene", scene, "scene.ply")
    .expect(200);
  const result = (await owner.get(base + "/model")).body.model;
  assert.equal(result.state, "ready");
  assert.equal((await readdir(path.join(dir, "models"))).length, 1);
  assert.equal(result.minPhotos, 2);
  assert.deepEqual(result.camera, camera);
  assert.ok(!JSON.stringify(result).includes(job.leaseToken));
  await request(app).get(result.url).expect(404);
  await owner.get(result.url).expect(200);
  await owner
    .patch(base)
    .set("X-CSRF-Token", token)
    .send({ status: "published" })
    .expect(200);
  assert.equal(
    (await request(app).get(base + "/model")).body.model.state,
    "ready",
  );
  await request(app).get(result.url).expect(200);
  await owner
    .patch(base)
    .set("X-CSRF-Token", token)
    .send({ status: "archived" })
    .expect(200);
  await request(app).get(result.url).expect(404);
  const images = (await owner.get(base)).body.images;
  await owner
    .delete(base + "/images/" + images[0].id)
    .set("X-CSRF-Token", token)
    .expect(204);
  await owner.get(result.url).expect(404);
  assert.deepEqual(await readdir(path.join(dir, "models")), []);
  await pool.query(
    "UPDATE property_models SET available_at=now()-interval '1 minute' WHERE property_id=$1",
    [propertyId],
  );
  const expiring = (await internal("post", "/claim").send({})).body.job;
  await pool.query(
    "UPDATE property_models SET lease_until=now()-interval '1 minute' WHERE property_id=$1",
    [propertyId],
  );
  const replacement = (await internal("post", "/claim").send({})).body.job;
  assert.notEqual(replacement.leaseToken, expiring.leaseToken);
  await internal("post", `/${propertyId}/heartbeat`)
    .send({ revision: expiring.revision, leaseToken: expiring.leaseToken })
    .expect(409);
  await internal("post", `/${propertyId}/fail`)
    .send({
      revision: replacement.revision,
      leaseToken: replacement.leaseToken,
      code: "reconstruction_failed",
    })
    .expect(200);
  await pool.query(
    "UPDATE property_models SET available_at=now()-interval '1 minute' WHERE property_id=$1",
    [propertyId],
  );
  const lastAttempt = (await internal("post", "/claim").send({})).body.job;
  assert.equal(lastAttempt.revision, replacement.revision);
  await pool.query(
    "UPDATE property_models SET lease_until=now()-interval '1 minute' WHERE property_id=$1",
    [propertyId],
  );
  assert.equal((await internal("post", "/claim").send({})).body.job, null);
  assert.equal((await owner.get(base + "/model")).body.model.state, "failed");
  await owner
    .post(base + "/images")
    .set("X-CSRF-Token", token)
    .attach("images", png, "retry.png")
    .expect(201);
  await pool.query(
    "UPDATE property_models SET available_at=now()-interval '1 minute' WHERE property_id=$1",
    [propertyId],
  );
  const concurrent = await Promise.all([
    internal("post", "/claim").send({}),
    internal("post", "/claim").send({}),
  ]);
  assert.equal(concurrent.filter((r) => r.body.job).length, 1);
  const restarted = createApp();
  try {
    const persisted = await request(restarted.app)
      .get(base + "/model")
      .set("Cookie", (await owner.get(base)).headers["set-cookie"] || [])
      .expect(200);
    assert.equal(persisted.body.model.state, "processing");
  } finally {
    restarted.close();
  }
  const active = concurrent.find((r) => r.body.job).body.job;
  await owner
    .patch(base)
    .set("X-CSRF-Token", token)
    .send({ category: "commercial_land" })
    .expect(200);
  assert.equal((await owner.get(base + "/model")).body.model.state, "none");
  await internal("post", `/${propertyId}/heartbeat`)
    .send({ revision: active.revision, leaseToken: active.leaseToken })
    .expect(409);
  await owner.delete(base).set("X-CSRF-Token", token).expect(204);
  await internal("post", `/${propertyId}/heartbeat`)
    .send({
      revision: replacement.revision,
      leaseToken: replacement.leaseToken,
    })
    .expect(409);
});
