---
retired: true
title: "Resolve the Caller Project and Action Interface"
sectionSlug: how-do-local-and-shared-action-paths-work
order: 2
revision: 3
---

## Current situation

A monorepo caller validates backend through a local composite action, with Node selected manually.

## The issue

The caller points to the wrong action directory; the action installs at repository root and hard-codes its runtime.

## Your task

Use the actual action path, pass node and directory explicitly, install in backend, and preserve the validated-revision output. The package files exist only under backend.

Edit the workflow and `.github/actions/validate/action.yml`. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: backend on node 22; backend on node 24. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
