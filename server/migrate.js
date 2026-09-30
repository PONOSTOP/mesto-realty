import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool, transaction } from "./db.js";

export async function migrate() {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(483971)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const dir = fileURLToPath(new URL("../migrations/", import.meta.url));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const name of files) {
      if (
        (
          await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [
            name,
          ])
        ).rowCount
      )
        continue;
      await client.query(await readFile(path.join(dir, name), "utf8"));
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
        name,
      ]);
      console.log(`Applied ${name}`);
    }
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await migrate();
  } finally {
    await pool.end();
  }
}
