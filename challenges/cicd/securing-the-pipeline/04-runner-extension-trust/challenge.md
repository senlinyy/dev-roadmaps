---
title: "Untrusted Work Reaches a Trusted Runner"
sectionSlug: why-are-runners-and-pipeline-extensions-trust-boundaries
order: 4
revision: 1
---

## Current situation

The release recipe selects a general-purpose worker and accepts any revision of its publisher extension. The scenario distinguishes public and production-reachable worker pools.

## The issue

Job labels do not establish worker trust, and a mutable extension can change the code granted release authority without a workflow change.

## Your task

Keep ordinary validation on disposable public workers. Select the controlled release pool only for the authorized mainline release, pin publisher@a1b2c3 in runner-policy.yaml, and require trusted-pool eligibility. Preserve the scoped deploy:checkout permission and production-only secret reference.

## Success criteria

Approved mainline release reaches the production network through the release pool. Forked work, an unapproved extension revision, and an unrelated repository cannot gain release access. Healthy source validation stays on the public pool.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

Jobs select pool and fresh. Pools and extension identities come from scenario fixtures. access evaluates trustedPool and allowed extensions in addition to workload claims. No extension code or network request executes.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
