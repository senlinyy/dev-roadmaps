---
title: "Repair Safe Rollout Pacing"
sectionSlug: rollingupdate-pacing
order: 1
---

The notification API has three replicas, but its manifest has no rollout pacing or progress contract. Build the release controls for a cluster that can schedule one temporary Pod, then promote the approved image.

Your job:

1. **Keep three replicas** and use the approved image `ghcr.io/customer-notification/notification-api:2026.06.14-2`.
2. **Build a RollingUpdate strategy** with exactly one surge Pod and zero unavailable desired Pods.
3. **Define the availability window** as exactly `10` stable seconds before a ready Pod counts as available.
4. **Define the progress deadline** as exactly `300` seconds.

The grader checks the image, replica count, pacing, availability delay, and progress deadline in the parsed Deployment.
