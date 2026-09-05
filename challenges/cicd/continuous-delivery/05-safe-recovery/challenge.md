---
title: "Recover Without Rebuilding Yesterday"
sectionSlug: how-should-rollback-and-recovery-be-designed
order: 5
revision: 1
---

## Current situation

Production's new checkout release failed. The release archive retains the previous immutable package and its supported schema/health evidence.

## The issue

The emergency recipe rebuilds current source instead of restoring the previous object. Its recovery policy also ignores compatibility, verification, and retry convergence.

## Your task

Replace the rebuild recipe with recovery of the retained previous artifact. Require compatibility with production's current schema, verify the recovered package, and handle two attempts idempotently. Stop automatic recovery when compatibility or health fails; do not invent a forward repair.

## Success criteria

The compatible previous artifact is restored without any build, verified twice, and applied in one state transition. An incompatible schema prevents restoration; failed recovery health does not become success.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

download can retrieve explicitly authored release-archive artifacts. recover takes artifact, environment, policy. Recovery policy fields: compatible, verify, idempotent, attempts (1–3). No migrations or data repair execute.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
