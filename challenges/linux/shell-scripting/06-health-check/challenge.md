---
title: "Build a Real Health Check"
sectionSlug: how-do-exit-codes-tests-and-pipelines-control-decisions
order: 6
---

The current health script always reports success. Operations needs it to evaluate a service's config and PID files and return a status automation can trust.

You start in `/home/dev`. Your job:

1. **Repair `health-check.sh`** to accept a service name, config path, and PID path.
2. **Report `<service>: healthy` with status `0`** only when both files exist; otherwise report `<service>: unhealthy` with status `1`.
3. **Run it for healthy `orders` and unhealthy `payments`** using their seeded paths.

The grader checks both branches, their outputs, and their exit statuses.
