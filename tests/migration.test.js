import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readFile } from "node:fs/promises";

test("B2B migration removes residential stock, preserves accounts and actual commercial listings", async () => {
  if (
    !process.env.TEST_DATABASE_URL ||
    !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
  )
    throw new Error("Dedicated _test database required");
  const client = new pg.Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    const schema = `migration_b2b_${process.pid}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}`);
    await client.query(
      await readFile(
        new URL("../migrations/001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
    const user = (
      await client.query(
        "INSERT INTO users(name,email,password_hash) VALUES('Migration user','migration@example.com','unused-test-hash') RETURNING id",
      )
    ).rows[0];
    const insert = async (category, seedKey = null) =>
      (
        await client.query(
          `INSERT INTO properties(owner_id,title,deal,category,city,address,price,area,rooms,description,contact_name,contact_phone,seed_key) VALUES($1,'Test listing','sale',$2,'Москва','Тестовый адрес',100,100,2,'Description long enough for test','Контакт','+70000000000',$3) RETURNING id`,
          [user.id, category, seedKey],
        )
      ).rows[0].id;
    const residential = await insert("apartment");
    const commercial = await insert("commercial");
    const demo = await insert("commercial", "mesto-demo-6");
    await client.query(
      "INSERT INTO property_images(property_id,filename) VALUES($1,'unused.webp')",
      [residential],
    );
    await client.query(
      "INSERT INTO favorites(user_id,property_id) VALUES($1,$2)",
      [user.id, residential],
    );
    await client.query(
      "INSERT INTO sessions(sid,sess,expire) VALUES('retained-session','{}',now()+interval '1 day')",
    );
    await client.query(
      await readFile(
        new URL("../migrations/002_commercial_b2b.sql", import.meta.url),
        "utf8",
      ),
    );
    const rows = (
      await client.query("SELECT id,category FROM properties ORDER BY id")
    ).rows;
    assert.deepEqual(rows, [{ id: commercial, category: "free_purpose" }]);
    assert.equal((await client.query("SELECT id FROM users")).rowCount, 1);
    assert.equal((await client.query("SELECT sid FROM sessions")).rowCount, 1);
    assert.equal((await client.query("SELECT * FROM favorites")).rowCount, 0);
    assert.equal(
      (await client.query("SELECT * FROM property_images")).rowCount,
      0,
    );
    assert.equal(
      (
        await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='properties' AND column_name='rooms'",
          [schema],
        )
      ).rowCount,
      0,
    );
    await client.query("SAVEPOINT reject_residential");
    await assert.rejects(
      client.query("UPDATE properties SET category='house' WHERE id=$1", [
        commercial,
      ]),
      (err) => err.code === "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT reject_residential");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
