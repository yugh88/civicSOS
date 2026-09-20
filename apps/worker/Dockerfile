# CivicSOS status-check worker.
#
# A one-shot container: it reads a batch of checks, opens Chromium, reads each
# public status page, publishes what it saw, and exits. Nothing runs between
# invocations, which is why this is an on-demand ECS task rather than a service.
#
# Built on Playwright's own image rather than installing Chromium by hand —
# getting the shared-library set right for headless Chromium on Debian is a
# solved problem not worth re-solving here. The tag is pinned deliberately: an
# unpinned browser image means the page a worker sees can change without anyone
# changing this repository, and the selector guard in build.mjs would not catch
# it because our own markup did not move.
#
# Build context is the repo root:
#   docker build -f apps/worker/Dockerfile -t civicsos-worker .

FROM mcr.microsoft.com/playwright:v1.49.1-noble AS build

WORKDIR /build

# Manifests first, so a source-only change does not reinstall the world.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/infra/package.json packages/infra/
COPY apps/worker/package.json apps/worker/

# The worker's two runtime deps, plus esbuild (which infra already depends on,
# so the bundle step adds no new tooling to the repo).
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/web/src/app/practice-portal apps/web/src/app/practice-portal
COPY apps/worker apps/worker

# Bundles the worker and the core slice it uses into dist/index.js, and fails
# the build if the practice target's selectors no longer match the page.
RUN npm run build --workspace @civicsos/worker

# ---------------------------------------------------------------------------

FROM mcr.microsoft.com/playwright:v1.49.1-noble AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    # The base image already ships the browsers; never re-download them.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Only what the bundle left external: Playwright and the EventBridge client.
COPY apps/worker/package.json ./package.json
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/apps/worker/dist ./dist

# Playwright's image ships a non-root `pwuser`. Chromium runs with --no-sandbox
# inside Fargate's own isolation boundary, so dropping root here is the
# meaningful privilege reduction available.
USER pwuser

# No entrypoint script and no health check: the task runs once and exits, and
# its exit code is the result. ECS reports that directly.
CMD ["node", "dist/index.js"]
