---
title: "Repair the Notification API Cluster Contract"
sectionSlug: putting-it-all-together
order: 1
---

The notification API Deployment retains its production identity, replica count, approved image, and named port, but the controller ownership and container operating contract were removed during review. Author the missing structures so the controller can own the intended Pods and the cluster can place and route them safely.

Your job:

1. **Keep Deployment `notification-api`** in namespace `notifications-prod` with exactly `3` replicas.
2. **Author matching ownership structures** with `app: notification-api` and `component: api` in both the selector and Pod template labels.
3. **Author readiness for container `api`** on path `/ready` and named port `http`, keeping image `ghcr.io/devpolaris/notification-api:1.7.0` unchanged.
4. **Author resource requests and limits** with requested CPU `250m`, requested memory `256Mi`, CPU limit `1`, and memory limit `512Mi`.

The grader checks every exact identity, label, image, readiness, and resource literal in the parsed manifest.
