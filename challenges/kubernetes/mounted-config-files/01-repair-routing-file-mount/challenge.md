---
title: "Repair the Routing File Mount"
sectionSlug: assembled-example
order: 1
---

The notification worker expects one reviewable routing file, but its otherwise approved Deployment has no file delivery path. Build the Pod volume and container mount so the approved ConfigMap key appears at the exact application path with the required file mode.

Your job:

1. **Build a Pod volume named `worker-routing`** sourced from ConfigMap `notification-worker-files`.
2. **Project key `routing.yaml`** as file `provider-routing.yaml` with `defaultMode` set to decimal `420`.
3. **Build the matching mount for `worker-routing`** in container `worker` at `/etc/notification` with `readOnly: true`.
4. **Keep image `ghcr.io/customer-notifications/notification-worker:1.8.0`** unchanged.

The grader checks every exact source, filename, mode, mount, container, and image literal.
