---
title: "Configure the Green Task Set"
sectionSlug: testing-green-before-users-reach-it
order: 1
---

The AppSpec file still points the replacement deployment at the old task definition and the wrong container port. CodeDeploy needs a clear description of the green task set before any traffic switch can be trusted.

Your task:

1. **Point the target service** at task definition `orders-api:42`.
2. **Send load balancer traffic** to container `orders-api`.
3. **Use container port `8080`** for the replacement task set.

The grader checks the AppSpec structure that CodeDeploy reads.

