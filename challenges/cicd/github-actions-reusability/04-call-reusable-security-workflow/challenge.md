---
retired: true
title: "Share a Validation Job Without Losing Its Result"
sectionSlug: how-do-reusable-workflows-pass-inputs-secrets-and-outputs
order: 4
revision: 3
---

## Current situation

Services need a reusable validation job with a typed runtime input and a returned commit identity.

## The issue

The caller invokes the workflow as a step; the shared workflow lacks a usable input/output contract.

## Your task

Move the reusable call to job level, declare workflow_call, thread the node input into setup, and return the validated revision through step, job, and workflow outputs.

Edit the workflow and `.github/workflows/shared.yml`. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: reusable checks pass; reusable checks fail. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
