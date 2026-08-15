---
title: "Build a Bounded OIDC Trust Policy"
sectionSlug: cicd-and-external-workloads
order: 1
---

The release workflow for `devpolaris/orders-api` must assume `orders-release-role` without stored AWS keys. Complete the role trust policy so only the `main` branch in that repository can use the existing GitHub OIDC provider. Keep the audience restricted to AWS STS. Do not trust the whole GitHub organization or use an AWS account principal.
