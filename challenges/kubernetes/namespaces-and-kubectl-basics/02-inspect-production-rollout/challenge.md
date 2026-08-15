---
title: "Inspect the Production Rollout Safely"
sectionSlug: the-safe-command-shape
order: 2
---

Your current kubeconfig context points at staging while a production notification rollout is failing. Use explicit targeting on every production read so the command history proves which cluster and namespace supplied the evidence.

Your job:

1. **Confirm the current context** before querying the incident.
2. **Read Deployment `notification-api`** from context `notifications-prod` and namespace `notifications-prod`.
3. **List the selected Pods** using label `app=notification-api` with the same explicit context and namespace.
4. **Read the last three log lines** from container `api` in the failing Pod and identify the dependency timeout.

The grader checks the command sequence, explicit production targeting, label-scoped Pod read, and final log evidence.
