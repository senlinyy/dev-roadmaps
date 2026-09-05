---
title: "Green Checks, Unsafe Merge"
sectionSlug: how-do-required-checks-protect-the-shared-mainline
order: 5
revision: 1
---

## Current situation

A checkout-service change has green results from an older branch state. The team is about to integrate candidate-43, and the editor includes a workflow plus the repository's merge policy.

## The issue

The current recipe checks head-42 and requires only lint. Missing or stale unit/type evidence can still permit integration.

## Your task

Repair both pipeline.yaml and merge-policy.yaml. Run lint, unit, and type checks against the proposed candidate, then require successful current-candidate evidence before merge. Keep the validation-to-merge dependency explicit; do not change repository fixtures.

## Success criteria

The healthy candidate merges. Failing unit tests, missing type evidence, and a check reporting an older revision block merge. Job names are flexible; the required check names are lint, unit, and types.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

checkout selects candidate or head. setup selects runtime 24. install uses mode locked. check names come from the scenario fixture. merge reads a policy with checks (list) and current (boolean). needs is a list of job names.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
