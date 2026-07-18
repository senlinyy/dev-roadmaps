---
title: "Build a Cache-Aware Multi-Stage Image"
sectionSlug: multi-stage-builds
order: 1
---

The shipping API currently compiles and runs from one large image. Refactor the Dockerfile so repeat builds reuse dependencies and the runtime image contains only production artifacts.

Your job:

1. **Create a `build` stage** from `node:22-alpine` and keep `/app` as the working directory.
2. **Use a BuildKit npm cache mount** while running `npm ci`, then copy the source and run `npm run build`.
3. **Create a separate `runtime` stage** and copy `/app/dist` from the build stage.
4. **Run as `node`** with `node dist/server.js` in exec form.

The grader checks stage boundaries, cache usage, the artifact handoff, and the non-root command.
