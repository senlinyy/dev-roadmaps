---
title: "Declare the Provider Contract"
sectionSlug: declaring-provider-requirements
order: 1
revision: 2
---

The platform root module must run in London and read disaster recovery resources in Ireland. Declare one provider dependency and two provider configurations without embedding credentials.

Your job:

1. **Require** `hashicorp/aws` with version constraint `~> 6.0`.
2. **Configure** the default AWS provider in `eu-west-2`.
3. **Configure** an aliased AWS provider named `dr` in `eu-west-1`.
4. **Keep** access key, secret key, and session token fields out of HCL.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
