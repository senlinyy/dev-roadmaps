---
title: "Repair the Orders API Autoscaler"
sectionSlug: horizontal-pod-autoscaling
order: 1
---

The orders API HPA retains its production identity and approved scale-down stabilization, but its target and metric contract were lost during a merge. Author the missing autoscaling structures without changing the existing metadata or behavior policy.

Your job:

1. **Author the scale target relationship** for Deployment `devpolaris-orders-api` through `apps/v1`.
2. **Define a replica range** from minimum `3` to maximum `10`.
3. **Author a Resource metric** named `cpu`.
4. **Define its Utilization target** as average utilization `70`.
5. **Keep the HPA named `devpolaris-orders-api`** in the `orders` namespace.

The grader checks the parsed HPA identity, scale target, replica boundaries, and exact CPU metric contract.
