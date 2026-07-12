---
title: "Mount the Webhook TLS Secret"
sectionSlug: mount-secrets-as-files
order: 2
---

The webhook receiver expects certificate files at `/etc/notification/tls`, but its otherwise approved Deployment has no TLS delivery path. Build the Pod volume and container mount so the approved TLS Secret is projected through a narrow, read-only file contract.

Your job:

1. **Build a Pod volume named `notification-webhook-tls`** sourced from Secret `notification-webhook-tls`.
2. **Project key `tls.crt` as `server.crt`** and key `tls.key` as `server.key`.
3. **Build the matching mount in container `api`** at `/etc/notification/tls`.
4. **Make the mount read-only** while keeping the approved image unchanged.

The grader checks the Secret source, selected key paths, and matching container mount.
