---
title: "Assume The Deploy Role"
sectionSlug: role-assumption-is-a-controlled-handoff
order: 4
---

A deploy pipeline should not keep a permanent AWS access key. In this practice step, the pipeline starts as `arn:aws:iam::123456789012:user/devpolaris-learner` and asks STS for a short-lived session on role `arn:aws:iam::123456789012:role/devpolaris-github-deploy-role` named `github-actions-deploy`.

Your job:

1. **Confirm the starting caller identity**.
2. **Assume the deploy role** using role ARN `arn:aws:iam::123456789012:role/devpolaris-github-deploy-role` and session name `github-actions-deploy`.

The grader checks that your output shows the original caller and the assumed role session.
