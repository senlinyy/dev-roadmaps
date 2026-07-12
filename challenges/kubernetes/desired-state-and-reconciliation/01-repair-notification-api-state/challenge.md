---
title: "Repair the Notification API Desired State"
sectionSlug: putting-it-all-together
order: 1
---

The production Deployment retains its identity and rollout-history safeguards, but the reconciliation contract was removed during a merge. Author the missing desired-state structures so controllers own three matching Pods, readiness protects Service traffic, and rolling updates preserve available capacity.

Your job:

1. **Author the replica and ownership contract** for exactly `3` Pods using selector and template label `app.kubernetes.io/name: notification-api`.
2. **Build the Pod template** around container `api` and image `ghcr.io/devpolaris/notification-api:1.4.3`.
3. **Declare named port `http`** on container port `3000`.
4. **Author a readiness probe** for path `/readyz` on port `http`.
5. **Author a RollingUpdate strategy** with maximum surge `1` and maximum unavailable `0`.

The grader checks every exact desired-state literal in the parsed Deployment manifest.
