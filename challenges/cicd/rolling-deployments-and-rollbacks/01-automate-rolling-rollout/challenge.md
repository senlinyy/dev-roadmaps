---
title: "Automate the Rolling Rollout"
sectionSlug: automating-the-rollout
order: 1
---

The workflow hides the wrong operational story. It updates the ECS service before registering the new task definition and never watches the rollout signals.

Your task:

1. **Register the new task definition** from the tested image digest before the service update.
2. **Update the ECS service** only after the task definition exists.
3. **Wait for target health** before treating the rollout as live.
4. **Watch rollout signals** for fifteen minutes before declaring success.

The grader checks the production environment and the ordered rollout steps.

