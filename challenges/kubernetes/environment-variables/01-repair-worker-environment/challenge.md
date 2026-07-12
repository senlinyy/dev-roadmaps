---
title: "Repair the Worker Environment Contract"
sectionSlug: assembled-example
order: 1
---

The notification worker Deployment has its approved image, replica identity, and metrics port, but no startup environment contract. Build the container environment so plain configuration, sensitive provider access, and live Pod identity each come from the source approved for that kind of data.

Your job:

1. **Keep container `worker`** on image `ghcr.io/customer-notifications/notification-worker:1.8.0`.
2. **Build `QUEUE_NAME`** from key `QUEUE_NAME` in ConfigMap `notification-worker-config`.
3. **Build `EMAIL_PROVIDER_TOKEN`** from key `EMAIL_PROVIDER_TOKEN` in Secret `notification-worker-secrets`.
4. **Build `POD_NAME`** from Downward API field path `metadata.name`.

The grader checks every exact source literal and the approved container image.
