---
title: "Repair the Production Dockerfile"
sectionSlug: a-clean-first-dockerfile
order: 1
---

The shipping API image is slow to build and sends the entire repository into the build context. Repair the supplied Dockerfile and .dockerignore without changing the Node.js 22 Alpine base image.

Your job:

1. **Copy package manifests before application source** so dependency installation can stay cached.
2. **Install locked production dependencies** with `npm ci --omit=dev`.
3. **Copy only `src/`**, run as the existing `node` user, and keep `npm start` as the exec-form command.
4. **Exclude `node_modules`, `.git`, `.env`, and `coverage`** from the build context.

The grader checks both files and rejects a broad `COPY . .` instruction.
