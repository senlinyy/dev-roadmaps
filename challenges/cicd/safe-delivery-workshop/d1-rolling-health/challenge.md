---
title: "Keep requests alive during a rolling release"
sectionSlug: keep-requests-alive-during-a-rolling-release
order: 1
revision: 1
---

## Description

Orders runs on ECS behind an ALB. During rolling replacement, in-flight requests are reset and half the old capacity disappears before replacement tasks become healthy. Application shutdown, load-balancer draining, and rollout capacity are not coordinated.

As the release engineer, repair the application and deployment settings so requests bounded to 20 seconds can complete while healthy service capacity is maintained.

## Requirements

1. **Replacement Capacity**. Keep healthy capacity at the desired count while allowing replacement tasks to start alongside existing tasks.
2. **Readiness and Health**. Configure task health and ALB readiness so new tasks receive traffic only when ready.
3. **Graceful Shutdown**. Stop accepting new requests during shutdown and allow bounded in-flight work to finish.
4. **Timing and Rollback**. Align ALB draining, ECS `stopTimeout`, and the application’s shutdown budget. Configure rollback for unhealthy candidates.

:::expand[Workspace and verification]{kind="note"}

Editable files: `src/server.js`, `ecs/task.json`, `ecs/update.json`, `alb/attributes.json`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
