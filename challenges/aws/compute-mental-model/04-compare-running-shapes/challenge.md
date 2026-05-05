---
title: "Compare Running Shapes"
sectionSlug: where-scaling-and-failures-show-up
order: 4
---

Use the AWS CLI to compare three compute shapes: EC2 instance `i-orders-api-01`, ECS service `devpolaris-orders-api` in cluster `devpolaris-orders-prod`, and Lambda function `devpolaris-receipt-email`.

Your job:

1. **Inspect the EC2 instance** and notice the server-shaped evidence.
2. **Inspect the ECS service** and notice the desired-versus-running copy count.
3. **Inspect the Lambda function** and notice the handler-shaped settings.

The grader checks that you compared all three compute shapes from AWS evidence.
