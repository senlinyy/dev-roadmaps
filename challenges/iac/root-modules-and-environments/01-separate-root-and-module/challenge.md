---
title: "Separate the Production Root and Shared Module"
sectionSlug: what-lives-in-an-environment-folder
order: 1
revision: 2
---

The repository has a reusable service module and a production root. Finish the production boundary so state, provider target, and environment-specific inputs remain in the root while the child module stays reusable.

Your job:

1. **Configure** the production S3 backend key as `orders/prod/terraform.tfstate`.
2. **Configure** the root AWS provider in `eu-west-2`.
3. **Call** `../../modules/service` with environment `prod` and replica count `3`.
4. **Keep** backend and provider blocks out of the child module.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
