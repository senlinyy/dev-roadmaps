---
title: "Configure OIDC for AWS"
sectionSlug: openid-connect
order: 2
---

Your team is replacing static AWS keys with OpenID Connect so deployment jobs receive short-lived cloud credentials. Update the deployment job so GitHub can request an identity token and exchange it for the approved AWS role.

Your job:

1. **Grant only the workflow permissions needed for checkout and identity-token exchange**.
2. **Configure the AWS credential action** to assume the production deployment role.
3. **Keep the deploy command in the protected production job**.

The grader checks the workflow structure, not a prose explanation.
