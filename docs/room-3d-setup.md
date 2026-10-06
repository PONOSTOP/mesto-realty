# Room 3D GPU worker setup

The website queues reconstructions; its normal web container does not perform GPU reconstruction. Deploy this separate worker on a Linux NVIDIA GPU host or a Windows PC with Docker Desktop. These instructions do not provision or rent infrastructure. A real room reconstruction has not been verified on this development machine.

Prerequisites: Docker with Compose GPU support, NVIDIA drivers and NVIDIA Container Toolkit, outbound HTTPS access to the website, enough temporary disk for up to 200 photographs and Nerfstudio outputs, and a GPU supported by Nerfstudio/PyTorch. The upstream documentation estimates about 6 GB GPU memory for default Splatfacto; allow room for image resolution and CUDA compilation. Verify the actual host with a real indoor dataset before enabling production jobs.

The Dockerfile pins the official Nerfstudio 1.1.5 image by digest. The GHCR registry returned `sha256:b59b8e1012d7a43679d3234b3de9c8416a4b8435fcbf21b9d8c4494b8563f19e` for that version on 2026-10-06. The worker runs as UID 10001, sequentially, without an exposed port or shell command interpolation.

1. Generate a private token, for example `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Keep it in the deployment secret manager; do not commit it or send it to the browser.
2. Configure the same `ROOM_MODEL_WORKER_TOKEN` (at least 32 characters) on the website and worker. Apply the website's room-model migration. Setting the server token enables its worker integration; leave the token unset until the GPU host is available. Optional server settings are `ROOM_MODEL_MIN_PHOTOS` (default 20) and `ROOM_MODEL_DEBOUNCE_SECONDS` (default 60).
3. Set `ROOM_MODEL_SITE_ORIGIN` to the exact HTTPS origin, such as `https://example.org`, without a path. Put the two worker values in the GPU host's secret environment. Optionally lower `ROOM_MODEL_TASK_TIMEOUT_SECONDS` (60–3600).
4. From `worker/`, run `docker compose up -d --build`. Use `docker compose logs --tail 50` to inspect generic failure messages. Credentials, private photograph URLs and command output are deliberately excluded from logs.
5. Upload at least the configured minimum number of connected room photographs with substantial overlap. After the debounce, confirm a claimed job, periodic heartbeats, a real exported scene, and usable initial camera orientation in the website. Check failure on disconnected photographs, cancellation after changing the photographs, and access restrictions on drafts. A mocked test result is not proof of reconstruction quality.

## Windows PC with Docker Desktop

Use Docker Desktop's Linux containers with WSL 2 and a compatible NVIDIA Windows driver. Verify GPU passthrough before starting the worker. No incoming port or public tunnel is required: the worker polls the website over HTTPS.

Keep the site's origin and private token in the ignored `worker/.env` file. On Dockhost, set the identical token as `ROOM_MODEL_WORKER_TOKEN` in the running website container's environment, not only as a build argument. Apply the updated container configuration. Copy only the value to the right of `=` without the variable name or quotes; never paste the token into chat or commit it.

From the repository root in PowerShell:

```powershell
docker compose -f worker/compose.yaml --env-file worker/.env up -d --build
docker compose -f worker/compose.yaml --env-file worker/.env ps
docker compose -f worker/compose.yaml --env-file worker/.env logs --tail 30
```

The container has `restart: unless-stopped`. It resumes when Docker starts, but cannot process jobs while the PC is asleep, off, or Docker Desktop is closed. Check Docker Desktop's start-at-login setting separately. To stop processing, run `docker compose -f worker/compose.yaml --env-file worker/.env stop`.

A `401` response from an internal worker endpoint means that the website has not accepted the worker token. Check the running website container's environment and that its new configuration was applied. Do not rotate the local token independently: both sides must match. `Worker API unavailable` is deliberately generic and does not expose credentials or private photo URLs.

Local verification on 2026-10-06: Docker Desktop 29.6.2, NVIDIA RTX 3060 Ti (8 GB), and driver 591.74. The pinned image was downloaded with every layer's SHA-256 verified, imported, and the worker image built successfully. COLMAP GPU feature extraction completed on a generated test photograph. Nerfstudio 1.1.5 / gsplat 1.4.0 rendered a Gaussian on CUDA with finite output and 216 nonzero-alpha pixels. Cache writes passed as UID 10001 with both the existing volume and a fresh volume; the image creates the cache with the worker's ownership. The background worker is running with automatic restart. An authenticated HTTPS probe from its container still received `401` from Dockhost: website token configuration remains unresolved. This is a runtime smoke check, not proof of a complete room reconstruction or a connected production worker.

The worker uses standard-library urllib with Bearer authentication and rejects redirects and foreign origins. Image requests carry `X-Room-Model-Revision` and `X-Room-Model-Lease` headers. Neither is placed in a query string. Each image is bounded to 8 MB, the image count to 200, and the exported scene to 100 MB. Local filenames are generated from sequence indices and recognized JPEG/PNG/WebP signatures. Pillow (included by upstream Nerfstudio) decodes each bounded image with a maximum of 40 million pixels, rejects animation, and writes an RGB PNG: Nerfstudio 1.1.5 does not discover WebP files, and the website stores its processed photographs in WebP format. Conversion keeps at most one decoded photograph in memory at a time; budget temporary disk for up to roughly 120 MB per 40 MP RGB PNG plus preprocessing outputs. A separate temporary directory is removed after each job.

The processing pipeline is `ns-process-data images` (COLMAP with exhaustive matching), `ns-train splatfacto` (30,000 iterations, tensorboard, exit after training), then `ns-export gaussian-splat`. Less than half of input photographs registered, or fewer than three cameras, yields `insufficient_overlap`; other pipeline failures yield `reconstruction_failed`. The browser receives binary little-endian PLY. The initial camera comes from the first processed OpenGL camera-to-world transform: position is the fourth column, up is +Y, forward is -Z. Automatic pose scaling, centering and orientation are disabled during training so camera and exported scene share coordinates.

The server lease lasts five minutes and is refreshed every 60 seconds while commands run and between downloads. A stale 409 response terminates the active command process group and discards the obsolete job. Each task has a configured deadline of at most one hour. A hard watchdog also covers stalled HTTP: it kills and waits for command process groups, removes the exact registered job temporary directory, and exits the worker at the deadline; Compose restarts it and the server reclaims the expired lease. The worker handles one job at a time. The server controls retries; the worker does not resubmit stale completions.

For local tests only, `ROOM_MODEL_ALLOW_LOCAL_HTTP=1` permits HTTP to localhost/loopback. Never enable it for production. Run `python -m unittest discover -s tests -p '*worker_test.py'` and `python -m py_compile worker/room_model_worker.py` from the repository root (on Windows, use `py` if `python` is a Store alias). Install Pillow locally (`python -m pip install Pillow`) when running tests outside the upstream container. These checks validate HTTP headers, input limits, real WebP-to-RGB-PNG conversion, camera axes, command arguments, stale-process cancellation and hard-timeout cleanup without a GPU. End-to-end room reconstruction still needs verification on the GPU host.

Sources: [official installation/container instructions](https://github.com/nerfstudio-project/nerfstudio/blob/v1.1.5/docs/quickstart/installation.md), [Splatfacto training/export](https://docs.nerf.studio/nerfology/methods/splat.html), [custom dataset preprocessing](https://docs.nerf.studio/quickstart/custom_dataset.html), [versioned dataparser pose handling](https://github.com/nerfstudio-project/nerfstudio/blob/v1.1.5/nerfstudio/data/dataparsers/nerfstudio_dataparser.py).
