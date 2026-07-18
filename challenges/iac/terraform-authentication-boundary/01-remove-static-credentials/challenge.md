---
title: "Remove Static Provider Credentials"
sectionSlug: provider-blocks-with-no-hardcoded-secrets
order: 1
---

The production root module contains copied AWS credentials. The CI platform already supplies short-lived credentials through OIDC and the standard AWS environment variables. Repair the Terraform configuration.

Your job:

1. **Keep the AWS provider source and compatible `~> 5.0` constraint**.
2. **Read the region from a typed `aws_region` variable**.
3. **Configure the provider with only the region**.
4. **Remove access keys, secret keys, session tokens, and local profiles** from every Terraform file.

The grader checks the provider contract and rejects static credential fields.
