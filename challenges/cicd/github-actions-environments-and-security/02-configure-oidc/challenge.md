---
title: "Configure OIDC for AWS Deployment"
sectionSlug: setting-up-oidc-with-aws
order: 2
---

Your team is replacing static AWS credentials with OIDC (OpenID Connect) so that no long-lived secrets are stored in GitHub. The workflow needs to request an identity token from GitHub and use it to assume an IAM role in AWS.

Your task:

1. **Grant the job permission** to request an OIDC identity token from GitHub.
2. **Add the AWS credentials configuration action** that handles the token exchange with AWS STS.
3. **Specify the IAM role** the job should assume and the AWS region.

The grader checks for the correct permission scope and the presence of the OIDC credential action with a role-to-assume parameter.
