import { test } from "node:test";
import assert from "node:assert/strict";
import { safeReturnPath, esc, safeImage, select } from "../public/js/core.js";

test("empty filters stay unselected when option keys are numeric", () => {
  assert.match(
    select(
      "rooms",
      "Комнаты",
      { "": "Не важно", 0: "Студия", 1: "1 комната" },
      null,
    ),
    /value="" selected/,
  );
});

test("authentication return URLs cannot leave the site after URL normalization", () => {
  const origin = "https://mesto.example";
  for (const next of [
    "//evil.example",
    "/\n/evil.example",
    "/\t/evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    null,
  ]) {
    assert.equal(safeReturnPath(next, origin), "/account");
  }
  assert.equal(
    safeReturnPath("/account?tab=favorites", origin),
    "/account?tab=favorites",
  );
  assert.equal(safeReturnPath("/publish", origin), "/publish");
});
test("user text escapes HTML and quoted attributes", () => {
  assert.equal(
    esc("<img src=\"x\" onerror='alert(1)'>&"),
    "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;",
  );
});
test("images use only local validated media and assets paths", () => {
  for (const url of [
    "javascript:alert(1)",
    "//evil.example/x.png",
    "/media/../.env",
    '/assets/x" onerror="alert(1)',
  ])
    assert.equal(safeImage(url), "/assets/placeholder.svg");
  assert.equal(safeImage("/media/aabb.webp"), "/media/aabb.webp");
});
