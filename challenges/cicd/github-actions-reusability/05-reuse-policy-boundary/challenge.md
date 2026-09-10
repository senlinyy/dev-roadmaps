---
retired: true
title: "Keep Release Policy in the Caller Contract"
sectionSlug: how-do-reuse-boundaries-separate-mechanism-from-policy
order: 5
revision: 3
---

## Current situation

A shared release workflow serves multiple environments after application validation and packaging.

## The issue

The shared workflow hard-codes production and callers forward every secret without an explicit interface.

## Your task

Expose a typed environment input and one required deploy-token secret. Pass only STAGING_TOKEN, keep release downstream of validation/package, and deploy the downloaded artifact to staging.

Edit the workflow and `.github/workflows/release.yml`. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: authorized staging release; invalid source cannot reach release. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
