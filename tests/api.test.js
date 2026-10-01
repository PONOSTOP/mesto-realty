import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import sharp from "sharp";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error(
    "Set TEST_DATABASE_URL to a dedicated database ending in _test",
  );
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.UPLOAD_DIR = await mkdtemp(path.join(os.tmpdir(), "mesto-test-"));
process.env.NODE_ENV = "test";
const { createApp } = await import("../server/app.js");
const { migrate } = await import("../server/migrate.js");
const { pool } = await import("../server/db.js");
const instance = createApp();
const app = instance.app;
const owner = request.agent(app),
  stranger = request.agent(app);
let token, otherToken, propertyId, imageId;
const unique = Date.now();
const email = `owner-${unique}@example.com`;
const password = "Correct-horse-123!";
const property = {
  title: `Офис тест ${unique}`,
  deal: "sale",
  category: "office",
  city: "Москва",
  district: "Хамовники",
  address: "Улица Льва Толстого, 10",
  price: 12345678,
  area: 62.5,
  buildingClass: "A",
  floor: 8,
  ceilingHeight: 3.8,
  powerKw: 50,
  parking: true,
  tax: "included",
  description: "Офис в бизнес-центре, переговорная и выделенная серверная.",
  contactName: "Владелец",
  contactPhone: "+79991234567",
  status: "draft",
};
const png = await sharp({
  create: { width: 400, height: 300, channels: 3, background: "#427a60" },
})
  .png()
  .toBuffer();
before(async () => {
  await migrate();
});
after(async () => {
  await pool.query("DELETE FROM users WHERE email = ANY($1::text[])", [
    [email, `other-${unique}@example.com`],
  ]);
  instance.close();
  await pool.end();
  const cleanupDir = path.resolve(process.env.UPLOAD_DIR);
  if (
    path.dirname(cleanupDir) !== path.resolve(os.tmpdir()) ||
    !path.basename(cleanupDir).startsWith("mesto-test-")
  )
    throw new Error("Unsafe test cleanup path");
  await rm(cleanupDir, { recursive: true, force: true });
});

test("full persisted lifecycle, ownership, CSRF, uploads and public privacy", async (t) => {
  await t.test(
    "malformed CSRF and foreign origins return 403 without crashing",
    async () => {
      const session = await owner.get("/api/auth/session");
      await owner
        .post("/api/auth/login")
        .set("X-CSRF-Token", "é".repeat(64))
        .send({})
        .expect(403);
      await owner
        .post("/api/auth/login")
        .set("X-CSRF-Token", session.body.csrfToken)
        .set("Origin", "https://untrusted.example")
        .send({})
        .expect(403);
    },
  );
  await t.test(
    "CSRF blocks registration, valid register sets HttpOnly session",
    async () => {
      await owner
        .post("/api/auth/register")
        .send({ name: "Владелец", email, password })
        .expect(403);
      token = (await owner.get("/api/auth/session").expect(200)).body.csrfToken;
      const result = await owner
        .post("/api/auth/register")
        .set("X-CSRF-Token", token)
        .send({ name: "Владелец", email, password })
        .expect(201);
      token = result.body.csrfToken;
      assert.equal(result.body.user.email, email);
      assert.ok(result.headers["set-cookie"].some((x) => /HttpOnly/i.test(x)));
      assert.ok(!JSON.stringify(result.body).includes("password"));
      const { rows } = await pool.query(
        "SELECT password_hash FROM users WHERE email=$1",
        [email],
      );
      assert.match(rows[0].password_hash, /^\$2[aby]\$12\$/);
    },
  );
  await t.test(
    "logout invalidates session, login restores it with fresh CSRF",
    async () => {
      const previous = token;
      await owner
        .post("/api/auth/logout")
        .set("X-CSRF-Token", token)
        .expect(204);
      await owner.get("/api/me/properties").expect(401);
      token = (await owner.get("/api/auth/session")).body.csrfToken;
      await owner
        .post("/api/auth/login")
        .set("X-CSRF-Token", token)
        .send({ email, password: "wrong" })
        .expect(401);
      const result = await owner
        .post("/api/auth/login")
        .set("X-CSRF-Token", token)
        .send({ email, password })
        .expect(200);
      token = result.body.csrfToken;
      assert.notEqual(previous, token);
    },
  );
  await t.test(
    "creates private draft and denies publishing without photos",
    async () => {
      const result = await owner
        .post("/api/properties")
        .set("X-CSRF-Token", token)
        .send(property)
        .expect(201);
      propertyId = result.body.property.id;
      await request(app).get(`/api/properties/${propertyId}`).expect(404);
      await owner
        .patch(`/api/properties/${propertyId}`)
        .set("X-CSRF-Token", token)
        .send({ status: "published" })
        .expect(422);
      const listing = await owner.get("/api/me/properties").expect(200);
      assert.ok(listing.body.items.some((p) => p.id === propertyId));
    },
  );
  await t.test(
    "B2B API rejects residential categories and persists commercial details",
    async () => {
      for (const category of [
        "apartment",
        "house",
        "room",
        "land",
        "commercial",
      ]) {
        await owner
          .post("/api/properties")
          .set("X-CSRF-Token", token)
          .send({ ...property, category })
          .expect(422);
        await request(app)
          .get("/api/properties")
          .query({ category })
          .expect(422);
      }
      await owner
        .patch(`/api/properties/${propertyId}`)
        .set("X-CSRF-Token", token)
        .send({ rooms: 3 })
        .expect(422);
      const data = (
        await owner.get(`/api/properties/${propertyId}`).expect(200)
      ).body.property;
      assert.equal(data.buildingClass, "A");
      assert.equal(data.floor, 8);
      assert.equal(data.ceilingHeight, 3.8);
      assert.equal(data.powerKw, 50);
      assert.equal(data.parking, true);
      assert.equal(data.tax, "included");
      assert.equal("rooms" in data, false);
    },
  );
  await t.test(
    "rejects fake/oversized uploads and re-encodes valid images",
    async () => {
      await owner
        .post(`/api/properties/${propertyId}/images`)
        .set("X-CSRF-Token", token)
        .attach("images", Buffer.from('<svg onload="alert(1)"></svg>'), {
          filename: "fake.jpg",
          contentType: "image/jpeg",
        })
        .expect(422);
      await owner
        .post(`/api/properties/${propertyId}/images`)
        .set("X-CSRF-Token", token)
        .attach("images", Buffer.alloc(8 * 1024 * 1024 + 1), {
          filename: "huge.jpg",
          contentType: "image/jpeg",
        })
        .expect(413);
      const result = await owner
        .post(`/api/properties/${propertyId}/images`)
        .set("X-CSRF-Token", token)
        .attach("images", png, {
          filename: "../../photo.png",
          contentType: "image/png",
        })
        .expect(201);
      imageId = result.body.images[0].id;
      assert.match(result.body.images[0].url, /^\/media\/[a-f0-9-]+\.webp$/);
      await request(app).get(result.body.images[0].url).expect(404);
      await owner
        .get(result.body.images[0].url)
        .expect(200)
        .expect("Content-Type", /image\/webp/);
    },
  );
  await t.test(
    "publishes, filters through SQL and keeps public responses private",
    async () => {
      await owner
        .patch(`/api/properties/${propertyId}`)
        .set("X-CSRF-Token", token)
        .send({ status: "published" })
        .expect(200);
      const result = await request(app)
        .get("/api/properties")
        .query({
          q: "Хамовники",
          category: "office",
          minPrice: 12345678,
          maxPrice: 12345678,
          minArea: 62,
          maxArea: 63,
          buildingClass: "A",
          minCeilingHeight: 3.5,
          minPowerKw: 40,
          parking: "true",
          sort: "price_asc",
          limit: 1,
        })
        .expect(200);
      assert.equal(result.body.total, 1);
      assert.equal(result.body.items[0].id, propertyId);
      const detail = await request(app)
        .get(`/api/properties/${propertyId}`)
        .expect(200);
      for (const key of ["password", "email", "contactPhone", "seedKey"])
        assert.ok(!JSON.stringify(detail.body).includes(key), key);
      await request(app).get(detail.body.images[0].url).expect(200);
      const contact = await request(app)
        .get(`/api/properties/${propertyId}/contact`)
        .expect(200);
      assert.equal(contact.body.phone, property.contactPhone);
      const injected = await request(app)
        .get("/api/properties")
        .query({ q: "'; DROP TABLE users;--" })
        .expect(200);
      assert.equal(injected.body.total, 0);
      await request(app)
        .get("/api/properties")
        .query({ minPrice: 50, maxPrice: 10 })
        .expect(422);
    },
  );
  await t.test(
    "favorites are unique, persisted and require authentication",
    async () => {
      await request(app).get("/api/favorites").expect(401);
      await owner
        .post(`/api/favorites/${propertyId}`)
        .set("X-CSRF-Token", token)
        .expect(201);
      await owner
        .post(`/api/favorites/${propertyId}`)
        .set("X-CSRF-Token", token)
        .expect(201);
      const result = await owner.get("/api/favorites").expect(200);
      assert.equal(result.body.total, 1);
      assert.equal(result.body.items[0].isFavorite, true);
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM favorites WHERE property_id=$1",
              [propertyId],
            )
          ).rows[0].count,
        ),
        1,
      );
    },
  );
  await t.test(
    "a second user cannot mutate another owner property or images",
    async () => {
      otherToken = (await stranger.get("/api/auth/session")).body.csrfToken;
      const result = await stranger
        .post("/api/auth/register")
        .set("X-CSRF-Token", otherToken)
        .send({
          name: "Другой",
          email: `other-${unique}@example.com`,
          password,
        })
        .expect(201);
      otherToken = result.body.csrfToken;
      await stranger
        .patch(`/api/properties/${propertyId}`)
        .set("X-CSRF-Token", otherToken)
        .send({ title: "Чужое изменение" })
        .expect(404);
      await stranger
        .delete(`/api/properties/${propertyId}`)
        .set("X-CSRF-Token", otherToken)
        .expect(404);
      await stranger
        .delete(`/api/properties/${propertyId}/images/${imageId}`)
        .set("X-CSRF-Token", otherToken)
        .expect(404);
      await stranger
        .post(`/api/properties/${propertyId}/images`)
        .set("X-CSRF-Token", otherToken)
        .attach("images", png, "new.png")
        .expect(404);
    },
  );
  await t.test(
    "profile and avatar updates persist without mass assignment",
    async () => {
      const result = await owner
        .patch("/api/profile")
        .set("X-CSRF-Token", token)
        .send({
          name: "Новое имя",
          phone: "+79998887766",
          bio: "<script>alert(1)</script>",
          company: "Тестовая коммерческая компания",
          businessRole: "broker",
          email: "injected@example.com",
        })
        .expect(200);
      assert.equal(result.body.user.email, email);
      assert.equal(result.body.user.name, "Новое имя");
      assert.equal(result.body.user.company, "Тестовая коммерческая компания");
      assert.equal(result.body.user.businessRole, "broker");
      const detail = (
        await request(app).get(`/api/properties/${propertyId}`).expect(200)
      ).body;
      assert.equal(detail.owner.company, "Тестовая коммерческая компания");
      assert.equal(detail.owner.businessRole, "broker");
      assert.equal("email" in detail.owner, false);
      await owner
        .post("/api/profile/avatar")
        .set("X-CSRF-Token", token)
        .attach("avatar", png, "avatar.png")
        .expect(200);
      assert.match(
        (await owner.get("/api/profile")).body.user.avatar,
        /^\/media\//,
      );
    },
  );
  await t.test(
    "related cards preserve the current user favorite state",
    async () => {
      const created = await owner
        .post("/api/properties")
        .set("X-CSRF-Token", token)
        .send({ ...property, title: "Второй объект владельца" })
        .expect(201);
      const secondId = created.body.property.id;
      await owner
        .post(`/api/properties/${secondId}/images`)
        .set("X-CSRF-Token", token)
        .attach("images", png, "second.png")
        .expect(201);
      await owner
        .patch(`/api/properties/${secondId}`)
        .set("X-CSRF-Token", token)
        .send({ status: "published" })
        .expect(200);
      const detail = await owner.get(`/api/properties/${secondId}`).expect(200);
      assert.equal(
        detail.body.otherProperties.find((p) => p.id === propertyId)
          ?.isFavorite,
        true,
      );
      await owner
        .delete(`/api/properties/${secondId}`)
        .set("X-CSRF-Token", token)
        .expect(204);
    },
  );
  await t.test(
    "server recreation retains persisted data and sessions",
    async () => {
      const cookies = await owner.get("/api/auth/session");
      const sessionCount = (await pool.query("SELECT count(*) FROM sessions"))
        .rows[0].count;
      assert.ok(Number(sessionCount) >= 2);
      const second = createApp();
      try {
        const sessionCookie = cookies.headers["set-cookie"]?.[0]?.split(";")[0];
        assert.ok(sessionCookie);
        const session = await request(second.app)
          .get("/api/auth/session")
          .set("Cookie", sessionCookie)
          .expect(200);
        assert.equal(session.body.user.email, email);
        const detail = await request(second.app)
          .get(`/api/properties/${propertyId}`)
          .expect(200);
        assert.equal(detail.body.property.price, property.price);
      } finally {
        second.close();
      }
    },
  );
  await t.test(
    "owner edits, unpublishes, republishes and deletes with cascades",
    async () => {
      await owner
        .patch(`/api/properties/${propertyId}`)
        .set("X-CSRF-Token", token)
        .send({ price: 11000000, title: "Обновлённый офис" })
        .expect(200);
      assert.equal(
        (await request(app).get(`/api/properties/${propertyId}`)).body.property
          .price,
        11000000,
      );
      await owner
        .delete(`/api/properties/${propertyId}/images/${imageId}`)
        .set("X-CSRF-Token", token)
        .expect(422);
      await owner
        .patch(`/api/properties/${propertyId}`)
        .set("X-CSRF-Token", token)
        .send({ status: "archived" })
        .expect(200);
      await request(app).get(`/api/properties/${propertyId}`).expect(404);
      assert.equal((await owner.get("/api/favorites")).body.total, 0);
      await owner
        .patch(`/api/properties/${propertyId}`)
        .set("X-CSRF-Token", token)
        .send({ status: "published" })
        .expect(200);
      await owner
        .delete(`/api/favorites/${propertyId}`)
        .set("X-CSRF-Token", token)
        .expect(204);
      await owner
        .delete(`/api/properties/${propertyId}`)
        .set("X-CSRF-Token", token)
        .expect(204);
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM property_images WHERE property_id=$1",
              [propertyId],
            )
          ).rows[0].count,
        ),
        0,
      );
      await owner.get(`/api/properties/${propertyId}`).expect(404);
    },
  );
});
