---
title: "Bind the GitHub Deployer"
sectionSlug: workload-identity-federation
order: 2
---

Complete the service-account IAM policy for `deploy-orders@devpolaris-prod.iam.gserviceaccount.com`. Grant only `roles/iam.workloadIdentityUser` to the GitHub principal set for repository `devpolaris/orders-api` in workload identity pool `github`. Keep policy version 3 and include no user, group, domain, or service-account key member.

The grader checks the exact federation principal and binding boundary.
