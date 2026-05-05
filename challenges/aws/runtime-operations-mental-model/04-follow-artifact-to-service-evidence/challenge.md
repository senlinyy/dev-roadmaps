---
title: "Follow Artifact To Service Evidence"
sectionSlug: from-artifact-to-running-version
order: 4
---

The release record says image tag `2026-05-04.3` should be running for `devpolaris-orders-api`. The repository is `devpolaris-orders-api`, the ECS cluster is `devpolaris-orders-prod`, and the service is `devpolaris-orders-api`.

Your job:

1. **Inspect the image inventory** for repository `devpolaris-orders-api`.
2. **Inspect the task definition** that the service uses.
3. **Inspect the service** to connect the running service back to its task definition.

The grader checks AWS evidence for the image, task definition, and service.
