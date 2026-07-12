---
title: "Preserve Release Recovery Options"
sectionSlug: readiness-and-traffic-safety
order: 2
---

The new notification API release starts successfully, but the manifest has no traffic gate or revision retention contract for the production rollback runbook. Build both structures without changing the image.

Your job:

1. **Define revision retention** as exactly `5` old revisions so known good Pod templates remain available for rollback.
2. **Build the readiness gate** for `/health/ready` through named port `http` every `5` seconds.
3. **Complete the readiness contract** with a `2`-second timeout and failure threshold `3`.
4. **Keep the release image** `ghcr.io/customer-notification/notification-api:2026.06.14-2` unchanged.

The grader checks revision history and the complete readiness contract on the `api` container.
