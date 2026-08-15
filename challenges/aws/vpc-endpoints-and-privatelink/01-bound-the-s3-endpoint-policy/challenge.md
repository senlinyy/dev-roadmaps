---
title: "Bound the S3 Endpoint Policy"
sectionSlug: endpoint-policies-iam-and-resource-policies
order: 1
---

The private export workers use an S3 gateway endpoint. Complete its endpoint policy so any principal in the account can list only `devpolaris-exports-prod` and read or write only `exports/*` in that bucket. Do not grant delete access, do not use `s3:*`, and do not expose another bucket. Remember that this endpoint policy is an additional boundary, not a replacement for IAM and bucket policies.
