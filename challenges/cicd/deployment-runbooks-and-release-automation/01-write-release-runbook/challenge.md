---
title: "Write the Release Runbook"
sectionSlug: from-checklist-to-executable-runbook
order: 1
---

The draft runbook says "deploy and watch dashboards," but it does not name the checks, owners, stop rules, or rollback target. The release brief assigns Maya as release lead, Theo to application signals, and Iris to platform traffic. The known rollback target is task definition `orders-api:41` at image digest `sha256:6447f5a96a80a87f19f6a6549e6dc03f63a2b8124c9d1c2f4a71f5b95ab9a621`.

Your task:

1. **Add core pre-checks** that confirm the artifact digest exists, staging runs that digest, production is healthy, the rollback target exists, and required environment variables exist.
2. **Name the assigned release owners** in the matching `release_lead`, `app_engineer`, and `platform_engineer` fields.
3. **Add stop rules** that tell the team when to pause or revert.
4. **Name the rollback target** from the release brief with its task definition and image digest.

The grader checks the structured runbook fields.
