---
title: "Validate green before production traffic moves"
sectionSlug: validate-green-before-production-traffic-moves
order: 2
revision: 1
---

## Description

Orders already uses ECS-native blue/green deployment with separate ALB target groups and a restricted test listener. Its Lambda hook always returns success, allowing a candidate that starts but serves malformed order responses to receive production traffic.

As the release engineer, make functional validation a real pre-traffic gate while retaining the previous revision for recovery.

## Requirements

1. **Test Traffic**. Route the restricted test listener to green before the validation hook executes.
2. **Functional Validation**. Implement readiness and order-response contract checks in the Lambda hook instead of returning unconditional success.
3. **Promotion Gate**. Return `FAILED` when HTTP checks or response validation fail, and block the production traffic switch.
4. **Bake and Rollback**. Retain the previous revision for the specified bake period and alarm-driven rollback. Preserve the ECS-native deployment controller.

:::expand[Workspace and verification]{kind="note"}

Editable files: `ecs/update.json`, `lambda/pretraffic.py`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
