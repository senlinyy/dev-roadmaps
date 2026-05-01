---
title: "Automate the Runbook Workflow"
sectionSlug: automating-the-runbook-in-github-actions
order: 2
---

The release path should be started intentionally, accept the release record as input, and keep production approvals visible. Automation should remove typing without hiding the judgment gates.

Your task:

1. **Use `workflow_dispatch` inputs** for release id, image digest, and rollback task definition.
2. **Serialize production releases** with a concurrency group.
3. **Run the deploy job** under the production environment.
4. **Grant only needed permissions** for code checkout and OIDC.
5. **Keep precheck, deploy, smoke, and watch steps** visible in order.

The grader checks the GitHub Actions workflow.

