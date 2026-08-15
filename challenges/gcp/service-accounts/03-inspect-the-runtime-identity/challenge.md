---
title: "Inspect the Runtime Identity"
sectionSlug: debugging-the-caller-identity
order: 3
---

Production `orders-api` is denied access to `payments-api-token`. Gather evidence for service account `orders-runtime@devpolaris-prod.iam.gserviceaccount.com` and the project IAM policy.

Confirm the account is active, identify its immutable ID, and determine whether the project policy grants this runtime identity Secret Manager access. Do not impersonate the deployer or change policy during this investigation.
