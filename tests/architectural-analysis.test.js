import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFloorPlan } from "../server/architectural-analysis.js";
const scene = {
  version: 1,
  width: 6,
  depth: 4,
  height: 3,
  floors: [
    {
      points: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
      tone: "neutral",
    },
  ],
  walls: [
    { id: "w", start: [0, 0], end: [6, 0], thickness: 0.15, exterior: true },
  ],
  openings: [],
  columns: [],
  furniture: [],
  warnings: [],
};
const input = {
  plan: { bytes: Buffer.from("plan"), mime: "image/webp" },
  photos: [{ bytes: Buffer.from("photo"), mime: "image/webp" }],
  dimensions: { width: 6, depth: 4, height: 3 },
};
test("vision analysis includes bounded image inputs, parses JSON and enforces measured scale", async () => {
  let sent;
  const result = await analyzeFloorPlan(input, {
    apiKey: "test-secret",
    model: "vision-model",
    baseUrl: "https://provider.example/v1",
    fetchImpl: async (url, options) => {
      sent = { url, options };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(scene) } }],
        }),
      );
    },
  });
  assert.deepEqual(result, scene);
  assert.equal(sent.url, "https://provider.example/v1/chat/completions");
  const body = JSON.parse(sent.options.body);
  assert.equal(
    body.messages[1].content.filter((x) => x.type === "image_url").length,
    2,
  );
  assert.equal(body.model, "vision-model");
  assert.equal(sent.options.redirect, "error");
  assert.ok(!JSON.stringify(result).includes("test-secret"));
  await assert.rejects(
    analyzeFloorPlan(input, {
      apiKey: "secret",
      model: "vision",
      baseUrl: "https://provider.example/v1",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify({ ...scene, width: 7 }) } },
            ],
          }),
        ),
    }),
    (e) => e.code === "invalid_layout",
  );
});
test("provider failures and unreadable plans expose safe categories", async () => {
  await assert.rejects(
    analyzeFloorPlan(input, {
      apiKey: "secret",
      model: "vision",
      baseUrl: "https://provider.example/v1",
      fetchImpl: async () =>
        new Response("SECRET provider failure", { status: 503 }),
    }),
    (e) =>
      e.code === "provider_unavailable" &&
      e.diagnostic === "http_503" &&
      !e.message.includes("SECRET"),
  );
  await assert.rejects(
    analyzeFloorPlan(input, {
      apiKey: "secret",
      model: "vision",
      baseUrl: "https://provider.example/v1",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"error":"unreadable_plan"}' } }],
          }),
        ),
    }),
    (e) => e.code === "unreadable_plan",
  );
  await assert.rejects(
    analyzeFloorPlan(input, {
      apiKey: "",
      model: "",
      baseUrl: "https://provider.example/v1",
    }),
    (e) => e.code === "vision_unavailable",
  );
});
