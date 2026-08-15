---
title: "Enforce Keyless Workloads"
sectionSlug: guardrail-the-access-safety-boundary
order: 1
---

The production project must prevent creation of long-lived service account keys. Complete the Organization Policy resource so `iam.disableServiceAccountKeyCreation` is enforced directly on `projects/devpolaris-prod` instead of inherited from a parent.

Keep the policy focused on this one preventive control. Workload Identity Federation and service account impersonation remain the approved access paths.
