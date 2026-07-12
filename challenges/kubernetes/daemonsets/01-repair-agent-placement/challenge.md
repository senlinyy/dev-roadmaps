---
title: "Repair Log Agent Placement"
sectionSlug: add-node-selection-and-tolerations
order: 1
---

The notification log agent has its approved workload identity, but its controller ownership and Pod placement contracts are absent. Build both relationships before it reaches production.

Your job:

1. **Keep DaemonSet `notification-log-agent`** in namespace `observability`.
2. **Build the ownership relationship** so the selector and Pod template both use `app.kubernetes.io/name: notification-log-agent`.
3. **Build node selection** with `devpolaris.io/node-pool: app`.
4. **Build a toleration entry** with key `dedicated`, operator `Equal`, value `app`, and effect `NoSchedule`.

The grader checks every exact ownership, node-selection, and toleration literal in the parsed DaemonSet.
