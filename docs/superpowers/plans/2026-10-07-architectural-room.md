# Architectural room models implementation plan

> **For agentic workers:** Use superpowers:executing-plans for the integrated backend tasks and superpowers:subagent-driven-development for the isolated viewer task. Track completed tasks below.

**Goal:** Generate architectural geometry automatically from photographs, a floor-plan image and dimensions, and display overhead and interior views publicly.

**Architecture:** A strict parameterized scene is extracted through the existing server-side vision provider and validated against owner-supplied dimensions. A leased local worker triggers analysis; a separate persisted queue protects revisions. Three.js builds meshes from validated JSON; legacy splats do not appear in the new block.

**Tech Stack:** Express, PostgreSQL, sharp, existing OpenAI-compatible provider, standard-library Python worker, Three.js and esbuild, Playwright.

## Global constraints

- Plan JPEG/PNG/WebP up to 8 MB; photographs up to 200; at least one photograph required.
- Width/depth up to 200 m, height up to 50 m; positive finite dimensions.
- At most 500 walls, 500 openings, 300 furniture objects, 1 MB scene JSON. No executable content, external URLs, textures or arbitrary geometry in AI output.
- Model is a light architectural mesh, with roof hidden overhead and inside camera mode. Furniture without measurements is approximate.
- Automatic queue on input change; revision/lease checks before and after analysis; authenticated draft access; no browser/worker access to AI key.
- Constant 5-minute leases, 60-second renewal, 1-hour hard deadline, three job attempts. Same Dockhost persistent upload directory.
- Retain old artifacts for rollback; new viewer displays architectural results only. Local worker consumes architecture jobs instead of legacy training jobs.

## Scene and endpoint contracts

`parseArchitecturalScene(value, expectedDimensions)` in `public/js/architectural-schema.js` is the canonical pure validation function, returning a validated scene or throwing a safe error. Server and browser both use it.

Scene shape:

```js
{
 version:1, width:12, depth:8, height:3,
 floors:[{points:[[0,0],[12,0],[12,8],[0,8]],tone:'neutral'}],
 walls:[{id:'w1',start:[0,0],end:[12,0],thickness:0.15,exterior:true}],
 openings:[{wallId:'w1',kind:'window',offset:2,width:1.5,bottom:0.9,height:1.5}],
 columns:[{position:[6,4],width:0.4,depth:0.4,height:3}],
 furniture:[{kind:'sofa',position:[4,2],width:2,depth:0.8,height:0.8,rotation:0}],
 warnings:['Размеры мебели приблизительные']
}
```

Furniture kinds: `sofa`, `armchair`, `table`, `chair`, `bed`, `cabinet`, `kitchen`, `sink`, `toilet`, `desk`, `shelf`. Floor tones: `neutral`, `warm`. Position coordinates are x/z in metres. Opening offsets are measured from wall start. Reject zero-length walls, out-of-bounds coordinates, unknown keys/kinds, unknown wall references, openings extending past wall length or height, overlaps on a wall and dimension mismatch. Floors have 3–500 points; columns at most 300. All numbers finite. The provider must not fill unseen rooms from imagination.

Public/owner endpoints:

```text
GET /api/properties/:id/architecture
  -> {model:{state,revision,url?,errorCode?,warnings?}, inputs?:{planUrl,width,depth,height,hasPlan}}
PUT /api/properties/:id/architecture/input {width,depth,height}
POST /api/properties/:id/architecture/plan multipart field plan
DELETE /api/properties/:id/architecture/plan
GET /property-plans/:id/:uuid.webp
GET /architectural-models/:id/:revision/scene.json
```

Inputs are returned to owners; anonymous pending results are `none`. Artifact access requires published status or owner session. Inputs and upload endpoints require auth and CSRF. Successful writes return updated inputs/model, but clients may refresh the GET.

Worker endpoints use existing Bearer token, before session CSRF:

```text
POST /internal/architectural-models/claim {} -> {job:null|{propertyId,revision,leaseToken}}
POST /internal/architectural-models/:id/heartbeat {revision,leaseToken}
POST /internal/architectural-models/:id/analyze {revision,leaseToken} -> {ok:true}
POST /internal/architectural-models/:id/fail {revision,leaseToken,code}
```

`analyze` reads snapshots of plan, dimensions and selected photos, runs `analyzeFloorPlan({plan,photos,dimensions})`, rechecks lease, persists JSON atomically and sets ready. In-flight analysis is deduplicated per lease. Response-loss must not regress ready. Provider errors are safe categories; no raw provider messages/keys in responses or logs.

## Task 1: Canonical validation and AI analysis

Files: create `public/js/architectural-schema.js`, `server/architectural-analysis.js`, `tests/architectural-schema.test.js`, `tests/architectural-analysis.test.js`.

- [ ] Write failing tests for valid dimensioned plan, invalid wall/opening/furniture/unknown-key inputs, nonfinite/oversized payloads and provider parsing/errors.
- [ ] Run `node --test tests/architectural-schema.test.js tests/architectural-analysis.test.js`; confirm missing implementations fail.
- [ ] Implement `parseArchitecturalScene` and `analyzeFloorPlan({plan,photos,dimensions},{apiKey,model,baseUrl,fetchImpl})`. Encode bounded image data, use existing chat-completions API, parse JSON, validate against dimensions and return only canonical scene. Model/key default from server config at route call, not browser.
- [ ] Run the same tests to pass; commit `feat: validate and analyze architectural floor plans`.

## Task 2: Persistent inputs, queue and API

Files: create `migrations/004_architectural_models.sql`, `server/architectural-models.js`; modify `server/app.js`, `server/room-models.js`, `server/properties.js`; create `tests/architectural-api.test.js`.

- [ ] Write failing API cases using existing PostgreSQL test setup: ownership, auth/CSRF, dimensions, image plan upload, automatic revision changes, stale lease, ready artifact and deletion.
- [ ] Implement `queueArchitecturalModel(client,id)` plus public/worker routers and protected artifact functions. Snapshot image IDs, plan filename and dimensions in each revision; transactionally invalidate prior leases. Persist files under upload directory; image decoding and output sizes bounded.
- [ ] Wire photo/category mutation to queue, and property removal to artifact cleanup. Integrate new routes in app before/after CSRF as specified.
- [ ] Run `node --test --test-concurrency=1 tests/architectural-api.test.js` and existing API checks; commit `feat: queue architectural models from plan inputs`.

## Task 3: Architectural mesh viewer and owner form

Files: create `public/js/architectural-geometry.js`, `public/js/architectural-viewer-source.js`, `public/js/architectural-model.js`, `public/js/architectural-inputs.js`, `scripts/build-architectural-viewer.js`; modify `public/js/room-model.js`, `public/js/forms.js`, `public/styles.css`, `package.json`; create geometry/browser tests.

- [ ] Test known plan mesh dimensions, actual wall opening subtraction, furniture shapes, overhead/interior camera modes, mobile controls, disposal and strict CSP.
- [ ] Build floors from polygons, walls around opening rectangles, window frames/glass, doorway trim, columns and recognizable simplified furniture. Use white materials, soft illumination, neutral ground; no photo point-cloud look.
- [ ] Bundle Three.js and OrbitControls locally. Mesh viewer exposes `createArchitecturalViewer(host,scene)` with `setMode('top'|'inside')`, `reset()`, `dispose()`. Fit overhead camera to dimensions; select interior starting point on a floor, never in a wall; ceiling hidden overhead.
- [ ] `mountArchitecturalModel` polls new GET, lazy loads bundle on action and exposes top/inside/reset/fullscreen controls. Existing exported `mountRoomModel` delegates to new mount while `uploadPhotoBatches` remains intact.
- [ ] `mountArchitecturalInputs(form,propertyId)` returns `{save(id),dispose()}`. Owner inputs are separate plan upload and width/depth/height; save after successful photo batches, preserving successful writes on retry. Existing ceiling height may seed the height field. Hide all architectural guidance for land.
- [ ] Run geometry/browser checks and commit `feat: display architectural plans and interior views`.

## Task 4: Local worker orchestration

Files: modify `worker/room_model_worker.py`, `tests/room_model_worker_test.py`; modify setup/verification docs.

- [ ] Test architecture claim/analysis endpoints, Bearer restrictions, lease renewals during slow analyze, stale 409 handling and safe failure categories.
- [ ] Allow only the two known internal URL prefixes. Main loop claims architecture jobs, maintains heartbeat during analysis with bounded timeout and one-hour watchdog. It no longer starts legacy photo reconstruction automatically; old functions remain for rollback/testing.
- [ ] Run Python checks, rebuild Docker and verify authenticated production call after deployment. Commit `feat: run automatic architectural analysis jobs`.

## Task 5: Real service, visual review and deployment

- [ ] Test live provider with a dimensioned test plan and room photos; confirm geometry follows plan, rather than merely showing a photo.
- [ ] Review code and address Critical/Important findings; run required unit/API/browser/worker checks.
- [ ] Publish a clearly labeled architectural demonstration. Inspect desktop/mobile screenshots, overhead/interior modes, rotation and zoom; verify no CSP/JS errors.
- [ ] Update Dockhost, restart local worker, verify photos/plan/model survive site deployment. Record actual evidence and remaining limits; provide working object link.
