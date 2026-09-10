---
retired: true
title: "Replace Stored Cloud Keys with Workload Identity"
sectionSlug: how-do-oidc-and-aws-policies-replace-a-shared-cloud-key
order: 2
revision: 3
---

## Current situation

A release job still references dummy long-lived AWS keys; an authored role and environment are available.

## The issue

Static credentials bypass the intended identity chain, while the current role policy names the wrong repository.

## Your task

Remove static-key environment variables, grant id-token only to release, configure the supplied role exchange, and correct cloud-trust.json. Validation must never receive production authority.

Edit the workflow and `cloud-trust.json`. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: approved identity; different repository; no environment approval. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
