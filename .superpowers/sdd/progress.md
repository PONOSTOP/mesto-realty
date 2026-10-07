# Architectural model progress

Goal: automatic white architectural meshes from photos, floor plan and dimensions, public top/interior viewer, Dockhost deployment.

- Task 1 canonical schema and provider adapter: implemented; five focused tests passed. Backend read-only review found no issues here.
- Task 2 persisted input/queue/API: implemented; end-to-end API test passed. Review fixes: deletion locks artifact row; plan upload returns current preview URL.
- Task 3 isolated viewer implementer: UI/geometry/browser tests passed; review ceiling defect fixed and retested.
- Task 4 local orchestration: initial cloud version passed19 Python tests and connection proved409auth. Extension to local GPU inference in progress with isolated worker implementer.
- Task 5 provider live generation and Dockhost persistence/browser validation: pending.

No AI credentials leave server. No stale revision can publish. Owner dimensions authoritative; furniture estimates identified as such.

Live cloud generation returnedHTTP429; no ready model claimed. Ollama localGPU extension uses protected input downloads and canonical completion; backendred→green API testpassed and all22APItests passed. Ollama/model download and actual inference verification pending.
