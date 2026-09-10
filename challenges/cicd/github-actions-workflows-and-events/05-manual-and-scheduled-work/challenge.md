---
retired: true
title: "Separate Operator Intent from Nightly Work"
sectionSlug: how-do-manual-and-scheduled-runs-start
order: 5
revision: 3
---

## Current situation

Operators need optional packaging while scheduled maintenance must only validate and audit.

## The issue

The workflow always packages and ignores the manual input.

## Your task

Declare the boolean package input and the 02:17 UTC daily schedule. Keep validation common, audit schedule-only, and package only an explicit manual request.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: manual validation only; manual packaging requested; nightly audit; other scheduled event. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
