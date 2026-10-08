# Architectural model verification — 8 October 2026

The active property feature creates white architectural meshes from photographs, a floor-plan image and overall width/depth/height. The installed PC worker uses Qwen3-VL 8b-instruct through local Ollama on RTX3060Ti 8 GB. Photographs classify furniture types; a separate plan request locates structural and furniture symbols in image coordinates. Raster checks confirm wall strokes and opening gaps before conversion to metre coordinates. The server retains canonical geometry validation and revision/lease checks before publishing.

Live automatic generation succeeded for [public demonstration 23](https://477a-oc71-643k.gw-1a.dockhost.net/property/23), revision5. Uploading the plan and saving dimensions queued the job; the PC worker claimed it and completed the model without a manual 3D upload. Public JSON contains a 6 × 4 × 3 m footprint, four walls, one window, one doorway and four furniture items. Wall thickness and opening locations were confirmed against the uploaded raster. Furniture heights and unmeasured details are approximate.

Photographs are real room photographs from the [Mip-NeRF 360 research dataset](https://jonbarron.info/mipnerf360/). Its room photo set has no measured floor plan: the demo plan and dimensions are explicitly illustrative, as stated in the public description. This verifies the upload/generation/viewing flow; it does not establish measured reconstruction of that real room or accuracy across arbitrary plans. Unreadable exterior topology, unsupported strokes and unsupported diagonal openings fail rather than publish a substitute rectangle.

Verification completed:

- 41 Node unit checks and22 API checks passed.
- 45 Python worker checks passed, including measured scaling, omitted internal partitions, concave footprint, invented diagonal walls and opening boxes away from walls.
- Five architectural browser checks passed under strict CSP, including owner save/retry order, mobile navigation, malformed scenes and disposal. The existing13 general browser checks also passed during integration.
- Formatting, viewer bundle build and focused code review passed; both important review findings were fixed with failing-then-passing regressions.
- Anonymous live Chromium opened the ready model on desktop1440 ×1000 and mobile390 ×844. Top/interior modes, rotation, zoom, reset and fullscreen worked. No horizontal mobile overflow or JavaScript/CSP console errors.
- Application commits f0ec4e7 and2175ef8 were pushed through SSH to main; the live viewer asset matched the rebuilt file. Health, public model endpoint and asset returned HTTP200 after deployment.
- After worker restart and Dockhost deployments, all80 photos returned HTTP200. Plan and model hashes remained unchanged: scene `540415cdb4b3f85764a5424b8d733b16530f683cbc72f2f9fda156fd43117f20`, plan `e06ad8f0a6c258f6dfccd717631ef695020b85bd6b3e36cb35f510f7858fbe26`.

Live screenshots: `output/playwright/architecture-live-top.png`, `architecture-live-inside.png`, `architecture-live-mobile-top.png`, `architecture-live-mobile-inside.png`. The PC and Docker must stay running for new jobs; ready models are served from Dockhost independently. Persistent uploads disk remains required.
