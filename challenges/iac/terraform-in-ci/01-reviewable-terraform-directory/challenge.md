---
title: "Make Terraform Reviewable"
sectionSlug: target-context-beside-the-plan
order: 1
---

Make the production Terraform root module safe for pull request checks. Reviewers should be able to see which AWS provider family and region the root module targets, while CI supplies identity outside the committed Terraform files.

Your task:

1. Add the approved AWS provider source and constrain it to the current 5.x provider line.
2. Keep the root module pointed at the London AWS region.
3. Remove committed static credential arguments and seeded credential literals from provider configuration.
