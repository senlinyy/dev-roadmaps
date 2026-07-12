---
title: "Mount the Worker Routing Config"
sectionSlug: mount-a-configmap-as-files
order: 2
---

The notification worker reads provider routing rules from a file, but its otherwise approved Deployment has no configuration delivery path. Build the Pod volume and container mount contract so Kubernetes projects the approved routing object at the path the worker expects.

Your job:

1. **Build a Pod volume named `notification-routing`** sourced from ConfigMap `notification-routing-config`.
2. **Keep the worker container named `worker`** with its existing image.
3. **Build the matching container mount** for `notification-routing` at `/etc/notification`.
4. **Make that mount read-only** so the worker consumes configuration without treating the projected volume as application storage.

The grader checks the parsed volume source and matching container mount.
