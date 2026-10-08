# Architectural model progress

Goal: automatic white architectural meshes from photos, floor plan and dimensions, public top/interior viewer, Dockhost deployment.

- Task 1 canonical schema and provider adapter: implemented and reviewed.
- Task 2 persisted input/queue/API: implemented; 22 API checks passed. Review fixes: deletion locks artifact row; plan upload returns preview URL.
- Task 3 viewer: geometry and browser checks passed; ceiling defect fixed and retested.
- Task 4 local GPU orchestration: implemented and installed. 36 worker tests independently passed. RTX3060Ti detected, local instruct inference runs entirely on GPU. Photos classify furniture types separately; geometry receives only the plan image and typed appearance context.
- Task 5 real generation and Dockhost validation: IN PROGRESS. Cloud HTTP429; local 4b-thinking returned no final content, resolved by explicit instruct tag. 4b-instruct returned schema-valid geometry but missed visible openings and misplaced furniture, so end-to-end completion is not claimed. Testing a larger instruct model next.

41 Node unit checks and 36 Python worker checks passed on 8 October. Earlier complete API/general browser/architectural browser checks passed. Site changes through 226f264 pushed to main; live demo 23 remains failed revision3 until a satisfactory automatic generation succeeds.

No AI credentials leave the website. No stale revision can publish. Owner dimensions authoritative; furniture estimates identified as approximate. Demo floor plan and dimensions are explicitly illustrative because the real research photo dataset contains no measured floor plan.
