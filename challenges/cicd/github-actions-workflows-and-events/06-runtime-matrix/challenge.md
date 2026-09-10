---
retired: true
title: "Validate Every Supported Combination"
sectionSlug: how-do-matrix-jobs-and-concurrency-control-expanded-work
order: 6
revision: 3
---

## Current situation

Checkout supports Linux on Node 22/24 and Windows on Node 24.

## The issue

The existing workflow checks one combination and packages without waiting for compatibility evidence.

## Your task

Create a matrix with the unsupported Windows/22 exclusion. Collect all supported results even after failure, and gate packaging on the complete matrix.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: supported combinations pass; linux fails but windows still reports. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
