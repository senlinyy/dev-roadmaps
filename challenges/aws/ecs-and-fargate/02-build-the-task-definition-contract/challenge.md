---
title: "Build the Task Definition Contract"
sectionSlug: the-task-definition-contract
order: 2
---

Complete a production Fargate task definition for orders-api. Keep the execution role separate from the application task role, expose container port 3000, inject LOG_LEVEL as plain configuration, inject PAYMENTS_API_TOKEN from the supplied Secrets Manager ARN, send logs to the existing CloudWatch Logs group, and add a container health check. Use 512 CPU units and 1024 MiB of task memory with awsvpc networking.
