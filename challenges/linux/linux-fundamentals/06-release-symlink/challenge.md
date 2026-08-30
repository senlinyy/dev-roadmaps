---
title: "Switch the Active Release"
sectionSlug: how-do-links-and-mounts-change-what-a-path-reaches
order: 6
revision: 1
---

Release `20260830` has passed validation, but `/opt/orders-api/current` still selects release `20260824`. Update the deployment pointer without copying either release directory.

You start in `/home/dev`. Your job:

1. **Inspect the stored target** of `/opt/orders-api/current`.
2. **Replace the symbolic link** so it points to `/opt/orders-api/releases/20260830`.
3. **Resolve the updated link completely** and confirm the active release path.

The grader checks the link type, its final target, and the inspection workflow.
