---
title: "Test the runtime image rather than the source tree"
sectionSlug: test-the-runtime-image-rather-than-the-source-tree
order: 5
revision: 1
---

## Description

Orders passes its unit tests, but the released container exits immediately. The supplied startup log and Dockerfile show that source-tree checks are not enough to establish whether the final runtime image works.

As the release engineer, repair the container packaging and add verification of the actual image before it is published.

## Requirements

1. **Runtime Image**. Repair the multi-stage Dockerfile so the final image contains the compiled application and launches a valid runtime entrypoint.
2. **Runtime Security**. Run the application as a non-root user and keep build tools outside the final runtime layer.
3. **Image Verification**. Start the same local image that will be published and smoke-test both readiness and the orders endpoint.
4. **Failure and Cleanup**. Block publication when smoke verification fails, including a broken entrypoint, and remove the test container on failure as well as success.

:::expand[Workspace and verification]{kind="note"}

Editable files: `Dockerfile`, `scripts/smoke.sh`, `.github/workflows/package.yml`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
