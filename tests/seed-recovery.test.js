import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, unlink, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const run = promisify(execFile);

test("container seed restores lost demo cover URLs without changing listings or duplicating data", async () => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!url.pathname.endsWith("_test"))
    throw new Error("Dedicated _test database required");
  const schema = `seed_recovery_${process.pid}`;
  const client = new pg.Client({ connectionString: url.toString() });
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mesto-seed-recovery-"),
  );
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    url.searchParams.set("options", `-c search_path=${schema}`);
    const seed = () =>
      run(process.execPath, ["scripts/seed.js"], {
        env: {
          ...process.env,
          DATABASE_URL: url.toString(),
          UPLOAD_DIR: directory,
          NODE_ENV: "test",
        },
      });
    await seed();
    const photo = (
      await client.query(
        "SELECT i.filename,p.id FROM property_images i JOIN properties p ON p.id=i.property_id WHERE p.seed_key='mesto-b2b-1' AND i.position=0",
      )
    ).rows[0];
    assert.match(photo.filename, /^[a-f0-9-]{36}\.webp$/);
    const target = path.resolve(directory, photo.filename);
    assert.equal(path.dirname(target), path.resolve(directory));
    await unlink(target);
    await client.query("UPDATE properties SET price=777 WHERE id=$1", [
      photo.id,
    ]);
    await seed();
    assert.deepEqual(
      await readFile(target),
      await readFile(
        new URL("../public/assets/property-1.webp", import.meta.url),
      ),
    );
    const listing = (
      await client.query(
        "SELECT p.price,i.filename FROM properties p JOIN property_images i ON i.property_id=p.id WHERE p.id=$1",
        [photo.id],
      )
    ).rows[0];
    assert.equal(Number(listing.price), 777);
    assert.equal(listing.filename, photo.filename);
    assert.equal(
      Number(
        (await client.query("SELECT count(*) FROM properties")).rows[0].count,
      ),
      21,
    );
    assert.equal(
      Number(
        (await client.query("SELECT count(*) FROM property_images")).rows[0]
          .count,
      ),
      21,
    );
    await seed();
    assert.equal(
      Number(
        (await client.query("SELECT count(*) FROM properties")).rows[0].count,
      ),
      21,
    );
  } finally {
    assert.match(schema, /^seed_recovery_\d+$/);
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("mesto-seed-recovery-"));
    await rm(directory, { recursive: true, force: true });
  }
});
