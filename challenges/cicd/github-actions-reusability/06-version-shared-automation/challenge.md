---
retired: true
title: "Adopt Shared Automation Without Following a Moving Branch"
sectionSlug: how-should-shared-automation-be-versioned-and-owned
order: 6
revision: 3
---

## Current situation

A shared validation workflow changes its public input name on main. A reviewed immutable revision remains in the catalog.

## The issue

The caller follows main and reports an old constant rather than the shared output.

## Your task

Select the reviewed immutable workflow revision, supply its documented node input, and consume its revision output. The caller must keep working before and after the shared branch moves.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: shared branch before change; shared branch after breaking change. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
