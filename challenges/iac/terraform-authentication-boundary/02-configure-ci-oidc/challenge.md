---
title: "Configure GitHub Actions OIDC"
sectionSlug: cicd-authentication-with-oidc
order: 2
revision: 2
---

The production plan job still expects stored AWS keys. Replace that boundary with GitHub OIDC and a repository-scoped role assumption before Terraform initialization.

Your job:

1. **Grant** `id-token: write` and `contents: read` permissions.
2. **Configure** `aws-actions/configure-aws-credentials@v5` with region `eu-west-2`.
3. **Assume** role `arn:aws:iam::123456789012:role/devpolaris-terraform-plan`.
4. **Run** Terraform init and plan after credentials are configured.
5. **Do** not reference AWS access key secrets.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
