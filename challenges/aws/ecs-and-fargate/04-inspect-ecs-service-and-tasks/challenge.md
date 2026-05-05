---
title: "Inspect ECS Service And Tasks"
sectionSlug: services-desired-count-and-deployments
order: 4
---

The ECS service `devpolaris-orders-api` in cluster `devpolaris-orders-prod` runs in Region `us-east-1` and is meant to keep two private Fargate tasks alive behind target group `devpolaris-orders-api-tg`. Use the ECS CLI evidence to compare the service target with the running task copies.

Your job:

1. **Describe the ECS service** and check desired, running, pending, deployment, and load balancer evidence.
2. **List the service tasks** so you know which copies are currently running.
3. **Describe the tasks** and inspect status, health, Availability Zones, and task ENI details.

The grader checks that you followed service evidence down to running task evidence.
