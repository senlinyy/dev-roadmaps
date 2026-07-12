---
title: "Harden the Orders API"
sectionSlug: the-restricted-pod-shape
order: 1
---

The orders API Deployment keeps its production identity, ownership labels, image, and port, but its Pod hardening contract was removed during review. Author the Pod-level identity, container security, and temporary-storage structures required by the restricted shape.

Your job:

1. **Author the Pod security context** so processes run as non-root UID and GID `10001` with filesystem group `10001`.
2. **Keep container `api` and image `ghcr.io/devpolaris/orders-api:2026.07.11`**.
3. **Author the container security context** with privilege escalation disabled and the root filesystem read-only.
4. **Drop capability `ALL`** and use seccomp profile type `RuntimeDefault`.
5. **Author matching temporary-storage structures** that mount volume `tmp` at `/tmp` and back it with `emptyDir: {}`.

The grader checks every exact security field, the approved image, and the matching writable volume contract.
