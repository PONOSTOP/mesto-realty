import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const module = await import("../scripts/seed-media.js").catch(() => ({}));
test("demo photos recover missing files without overwriting existing uploads", async () => {
  assert.equal(typeof module.restoreDemoPhoto, "function");
  const dir = await mkdtemp(path.join(os.tmpdir(), "mesto-photo-repair-"));
  try {
    const name = "0525e6bd-ffd7-4176-aa0f-6bd969ca037c.webp";
    const source = new URL("../public/assets/property-1.webp", import.meta.url);
    await module.restoreDemoPhoto({ filename: name, source, uploadDir: dir });
    assert.deepEqual(
      await readFile(path.join(dir, name)),
      await readFile(source),
    );
    await writeFile(path.join(dir, name), "existing-photo");
    await module.restoreDemoPhoto({ filename: name, source, uploadDir: dir });
    assert.equal(
      await readFile(path.join(dir, name), "utf8"),
      "existing-photo",
    );
    await assert.rejects(
      module.restoreDemoPhoto({
        filename: "../outside.webp",
        source,
        uploadDir: dir,
      }),
    );
  } finally {
    assert.ok(
      path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep),
    );
    await rm(dir, { recursive: true, force: true });
  }
});
