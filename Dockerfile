# -----------------------------------------------------------------------------
# Refoss integration image.
#
# A Node.js service (the Gladys side, through the SDK) that talks to the
# Refoss devices of the local network: a WebSocket (port 80, /rpc) for the
# current models, signed HTTP messages (port 80) and a UDP search (9988 ->
# 9989) for the first ones.
#
# Gladys sandbox constraints ("the sandbox is the defense"):
#   - rootfs mounted READ-ONLY -> never write outside /data
#   - a single writable volume: /data (devices seen, energy indexes, timers)
#   - runs as a non-root user
#   - multi-arch image (linux/amd64 + linux/arm64), see build.yml
# -----------------------------------------------------------------------------
FROM node:24-trixie-slim

# The version label and the manifest label are added by build.yml.
LABEL org.opencontainers.image.title="gladys-refoss" \
      org.opencontainers.image.description="Refoss plugs, relays, shutters and energy monitors in Gladys Assistant, on the local network (not affiliated with Refoss)" \
      org.opencontainers.image.source="https://github.com/William-De71/gladys-refoss" \
      org.opencontainers.image.licenses="Apache-2.0"

# dumb-init: handles signals (SIGTERM) correctly for a graceful shutdown.
RUN apt-get update \
  && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the PROD dependencies first (better build cache). `npm ci` only:
# a lockfile out of sync with package.json must fail the build. No install
# scripts: the Gladys SDK and ws, pure JavaScript.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Then the integration code.
COPY index.js ./
COPY src ./src
COPY gladys-assistant-integration.json LICENSE NOTICE ./

ENV NODE_ENV=production

# The only writable location allowed at runtime. Docker creates a new volume
# with the owner of the image's /data, so it must belong to `node`, and before
# VOLUME: changes made to /data after it are discarded.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

# Run as an unprivileged user (already present in the node image).
USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
