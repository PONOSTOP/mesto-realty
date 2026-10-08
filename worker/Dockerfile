# Upstream release 1.1.5, digest verified through the GHCR registry API.
FROM ghcr.io/nerfstudio-project/nerfstudio:1.1.5@sha256:b59b8e1012d7a43679d3234b3de9c8416a4b8435fcbf21b9d8c4494b8563f19e
RUN useradd --create-home --uid 10001 roomworker \
    && install -d -o roomworker -g roomworker /home/roomworker/.cache
WORKDIR /opt/room-worker
COPY --chown=roomworker:roomworker room_model_worker.py architectural_grounding.py ./
USER roomworker
ENV PYTHONUNBUFFERED=1
CMD ["python", "/opt/room-worker/room_model_worker.py"]
