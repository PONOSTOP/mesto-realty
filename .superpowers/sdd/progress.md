# Architectural model progress

Goal: automatic white architectural meshes from photos, floor plan and dimensions, public top/interior viewer, Dockhost deployment.

- Task 1 canonical schema and provider adapter: implemented and reviewed.
- Task 2 persisted input/queue/API: implemented; 22 API checks passed. Review fixes: deletion locks artifact row; plan upload returns preview URL.
- Task 3 viewer: geometry and browser checks passed; ceiling defect fixed and retested.
- Task 4 local GPU orchestration: implemented and installed. 36 worker tests independently passed. RTX3060Ti detected, local instruct inference runs entirely on GPU. Photos classify furniture types separately; geometry receives only the plan image and typed appearance context.
- Task 5 real generation and Dockhost validation: COMPLETE. Direct scene inference was replaced by8b JSON plan observations, verified raster strokes/gaps and deterministic metric conversion. Live automatic demo23revision5 is READY with4walls,2openings and4furniture items. Desktop/mobile/top/interior/rotation/zoom/fullscreen verified without console errors. All80 photos, plan and model persisted through Dockhost updates and worker restart.

41 Node unit checks,22 API checks,45 Python worker checks and5 architectural browser checks passed. Earlier13 general browser checks passed. Focused review findings fixed and re-reviewed. Site changes through2175ef8 pushed to main; production asset hash matched. Evidence and limitations in docs/architectural-verification.md.

No AI credentials leave the website. No stale revision can publish. Owner dimensions authoritative; furniture estimates identified as approximate. Demo floor plan and dimensions are explicitly illustrative because the real research photo dataset contains no measured floor plan.
