---
title: "Read Task Definition Runtime Contract"
sectionSlug: from-ecr-image-to-task-definition
order: 5
---

The task definition `devpolaris-orders-api:42` in Region `us-east-1` is the release recipe ECS uses to start each copy. Inspect it before guessing at image, port, role, secret, or log problems.

Your job:

1. **Describe the task definition** and find the image, port, environment, secrets, roles, CPU, memory, and log group.
2. **Inspect task role `devpolaris-orders-api-prod-task-role` and execution role `devpolaris-orders-api-prod-execution-role`** so you can separate app permissions from setup permissions.

The grader checks that you read the runtime contract rather than only the service name.
