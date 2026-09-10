## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### Dockerfile

```dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node","dist/server.js"]
```

### scripts/smoke.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${IMAGE:?Set an immutable image reference}"
container=$(docker run -d -p 127.0.0.1::3000 "$IMAGE")
trap 'docker logs "$container"; docker rm -f "$container" >/dev/null' EXIT
port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' "$container")
for attempt in {1..30}; do
  if curl -fsS "http://127.0.0.1:$port/ready"; then
    curl -fsS "http://127.0.0.1:$port/orders" | jq -e '.orders | type == "array"'
    exit 0
  fi
  sleep 1
done
exit 1
```

### .github/workflows/package.yml

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  checks:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: docker build -t "orders:$GITHUB_SHA" .
      - run: bash scripts/smoke.sh
        env:
          IMAGE: orders:${{ github.sha }}
```

## Why this works

Compiling source and successfully starting the final image answer different questions. Multi-stage builds separate compiler dependencies from runtime bytes. The smoke harness discovers a dynamically allocated local port, retries startup for a bounded period and cleans up on both paths. It verifies a small HTTP contract, not database or full business correctness.

## Verification and expected evidence

Build with Docker and run `IMAGE=orders:review bash scripts/smoke.sh` after tagging the build orders:review. Restore the broken entrypoint in a separate build and confirm failure plus container cleanup.

## Self-review

- [ ] The final image runs as a non-root user and contains compiled runtime files.
- [ ] Smoke tests start the same local image that will be published.
- [ ] A broken entrypoint fails smoke verification and removes the test container.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.docker.com/build/building/multi-stage/)
