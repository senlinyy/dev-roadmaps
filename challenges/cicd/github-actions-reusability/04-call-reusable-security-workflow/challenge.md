---
title: "Call a Reusable Security Workflow"
sectionSlug: reusable-workflows
order: 4
---

Three services copy the same security job, so the platform team has moved that policy into a reusable workflow. Complete both files so the shared workflow exposes a typed service input and the caller invokes the approved version as a job.

Your job:

1. **Expose a required string input** named `service-name` through `workflow_call` in the shared workflow.
2. **Keep security permissions on the shared job** with read-only contents and write access for security events.
3. **Call the shared workflow** from the service repository at `acme/platform-workflows/.github/workflows/service-security.yml@v1`.
4. **Pass `checkout-api`** as the `service-name` input from the caller.

The grader checks the interface in the reusable workflow and its use at the caller job boundary.
