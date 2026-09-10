---
title: "Configure environments without baking secrets into images"
sectionSlug: configure-environments-without-baking-secrets-into-images
order: 7
revision: 1
---

## Description

Orders rebuilds its image for staging and production to embed different database URLs. Credentials appear in image history, and a later secret rotation did not reach already-running ECS tasks.

As the platform engineer, separate runtime configuration from the immutable application image and make secret rotation take effect through controlled task replacement.

## Requirements

1. **Environment-Neutral Image**. Remove environment-specific credentials from the Dockerfile and keep the same application image across environments.
2. **Task Configuration**. Move environment configuration and approved secret references into the task definition without embedding secret values.
3. **Secret Retrieval**. Scope secret retrieval permissions to the task execution role and the approved secret.
4. **Rotation Procedure**. Use controlled task replacement and connection verification after rotation; do not rebuild the application to refresh injected values.

:::expand[Workspace and verification]{kind="note"}

Editable files: `Dockerfile`, `ecs/task.json`, `iam/execution-secret-policy.json`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
