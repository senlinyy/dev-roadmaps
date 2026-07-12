---
title: "Add the Pod Health Contract"
sectionSlug: readiness-liveness-and-startup-probes
order: 2
---

The orders API needs 90 seconds to warm its caches. During normal operation, `/ready` decides whether the Pod can receive traffic and `/live` detects a deadlocked process. Add three HTTP probes without changing the image or application port.

Your job:

1. **Protect startup** with `/startup` on port `8080`, a 5-second period, and failure threshold `24`.
2. **Gate traffic** with `/ready` on port `8080`, a 5-second period, and failure threshold `3`.
3. **Detect deadlock** with `/live` on port `8080`, a 10-second period, and failure threshold `3`.

The grader checks all three probe contracts on the `api` container.
