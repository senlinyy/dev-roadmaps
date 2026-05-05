---
title: "Check Scaling And Queue Evidence"
sectionSlug: desired-count-and-target-tracking
order: 4
---

Checkout exports are slower after a release. The API service scaling target is `service/devpolaris-orders-prod/devpolaris-orders-api`, and the export queue URL is `https://sqs.us-east-1.amazonaws.com/123456789012/devpolaris-orders-export-jobs`.

Your job:

1. **Inspect the scalable target** for the ECS service.
2. **Inspect the queue attributes** for the export jobs queue.
3. **Keep both outputs visible** so the grader can see capacity bounds and backlog evidence.

The grader checks AWS scaling and queue evidence.
