---
title: "Add Lifecycle Guardrails"
sectionSlug: lifecycle-for-guardrails-and-replacement-behavior
order: 1
---

A production review found that load balancer replacement may destroy the old endpoint first and that the orders database has no deletion guard. Add narrow lifecycle rules without changing resource identity.

Your job:

1. **Create the replacement load balancer before destroying the old one**.
2. **Prevent Terraform from destroying the orders database**.
3. **Make the ECS service depend explicitly on the load balancer listener** because the dependency is hidden inside external deployment configuration.
4. **Keep each guardrail inside its owning resource block**.

The grader checks block-scoped lifecycle and dependency settings.
