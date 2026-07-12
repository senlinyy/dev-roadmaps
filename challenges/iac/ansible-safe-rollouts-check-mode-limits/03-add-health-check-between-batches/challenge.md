---
title: "Add Health Check Between Batches"
sectionSlug: "health-checks-between-batches"
order: 3
---

The play now rolls one host at a time, but each batch still needs service evidence before the next host changes. Add a local HTTP health check with retries after the role call.

Your job:

1. **Check the local health endpoint** at `http://127.0.0.1/health`.
2. **Treat HTTP 200 as success** and register the result as `orders_health`.
3. **Retry the check** up to five times with a three-second delay until the status is 200.

The grader checks the health-check task shape, not command output.
