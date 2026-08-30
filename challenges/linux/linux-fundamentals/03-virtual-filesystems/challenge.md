---
title: "Inspect the Live System"
sectionSlug: how-do-virtual-filesystems-expose-live-kernel-state
order: 3
revision: 2
---

The `orders-api` process is running as PID `4242`, but the deployment record does not say what it launched or which release directory it uses. The kernel exposes those answers through virtual filesystem paths.

You start in `/home/dev`. Your job:

1. **Identify the command line** that launched PID `4242`.
2. **Resolve the process working-directory entry** to its release path.
3. **Inspect the process environment** and find its `APP_ENV` value.
4. **Check whether block device `vdb` reports rotational storage** through `/sys`.

The grader checks the process, environment, path, and device evidence.
