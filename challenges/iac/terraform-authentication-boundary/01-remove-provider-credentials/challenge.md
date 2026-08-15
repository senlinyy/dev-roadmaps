---
title: "Keep Credentials Out of Provider Blocks"
sectionSlug: provider-blocks-with-no-hardcoded-secrets
order: 1
revision: 2
---

A copied provider block contains long-lived training credentials. Replace it with region and default-tag configuration that relies on the standard AWS credential chain.

Your job:

1. **Keep** the AWS region at `eu-west-2`.
2. **Set** default tags Service `orders` and ManagedBy `terraform`.
3. **Remove** access key, secret key, token, and profile attributes.
4. **Do** not move credential values into variables or locals.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
