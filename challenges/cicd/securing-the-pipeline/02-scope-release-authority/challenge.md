---
title: "Every Job Can See Production Secrets"
sectionSlug: how-should-pipelines-handle-secrets-and-credentials
order: 2
revision: 1
---

## Current situation

Checkout validation and release share a broad production identity policy. The scenario supplies ordinary mainline work plus untrusted and unrelated workload identities requesting privileged actions.

## The issue

Validation receives deployment credentials, and the policy grants broad permissions and unrelated secret references.

## Your task

Repair the job boundaries and identity.yaml. Keep source validation unprivileged; allow only the checkout-service mainline on main to receive deploy:checkout and secret://production-deploy for production. Preserve a functioning authorized release, and reject forked, unrelated-repository, or wrong-branch identities.

## Success criteria

Healthy validation completes and exactly one scoped authorization occurs in the protected release path. No database-admin reference or wildcard permission is exposed. Untrusted workloads cannot reach deployment.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

access consumes an identity policy with origins, repositories, branches, environments, permissions, secrets, trustedPool, and extensions. The scenario supplies immutable workload claims and requested operations; no credentials are issued.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
