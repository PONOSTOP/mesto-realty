import test from "node:test";
import assert from "node:assert/strict";
import {
  modelMarkup,
  validModelUrl,
  uploadPhotoBatches,
} from "../public/js/room-model.js";

test("only current local model paths may be viewed", () => {
  assert.equal(validModelUrl("/models/12/3/scene.ply"), true);
  for (const url of [
    "https://evil.test/scene.ply",
    "/models/../3/scene.ply",
    "/models/12/3/scene.ply?x=1",
    "/models/12%2f3/scene.ply",
  ])
    assert.equal(validModelUrl(url), false);
});
test("public pending states are hidden and ready controls are escaped", () => {
  assert.equal(modelMarkup({ state: "processing" }, false), "");
  assert.equal(
    modelMarkup({ state: "failed", errorCode: "<script>" }, false),
    "",
  );
  assert.match(
    modelMarkup({ state: "ready", url: "/models/12/3/scene.ply" }, false),
    /Открыть 3D/,
  );
  assert.equal(
    modelMarkup({ state: "ready", url: "javascript:alert(1)" }, false),
    "",
  );
  assert.doesNotMatch(
    modelMarkup({ state: "failed", errorCode: "<script>" }, true),
    /<script>/,
  );
  assert.match(
    modelMarkup({ state: "needs_photos", minPhotos: 26, imageCount: 4 }, true),
    /26/,
  );
});
test("photo uploads are sequential and preserve completed batches after failure", async () => {
  const pending = Array.from(
    { length: 25 },
    (_, i) => new Blob([String(i)], { type: "image/jpeg" }),
  );
  const sizes = [];
  let active = 0;
  const completed = [];
  await assert.rejects(
    uploadPhotoBatches(
      pending,
      async (data) => {
        assert.equal(active++, 0);
        sizes.push(data.getAll("images").length);
        await Promise.resolve();
        active--;
        if (sizes.length === 2) throw new Error("upload failed");
        return { images: ["saved"] };
      },
      (result) => completed.push(result.images),
    ),
    /upload failed/,
  );
  assert.deepEqual(sizes, [10, 10]);
  assert.equal(pending.length, 15);
  assert.deepEqual(completed, [["saved"]]);
});
