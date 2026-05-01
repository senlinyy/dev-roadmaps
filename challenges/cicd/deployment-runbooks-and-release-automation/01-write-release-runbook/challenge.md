---
title: "Write the Release Runbook"
sectionSlug: what-a-deployment-runbook-does
order: 1
---

The draft runbook says "deploy and watch dashboards," but it does not name the checks, owners, stop rules, or rollback target. Make the safe path obvious before production changes.

Your task:

1. **Add core pre-checks** for artifact, staging, production health, rollback target, and required environment variables.
2. **Name release owners** for decision, application signals, and platform traffic.
3. **Add stop rules** that tell the team when to pause or revert.
4. **Name the rollback target** with task definition and image digest.

The grader checks the structured runbook fields.

