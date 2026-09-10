---
retired: true
title: "Restore the Validation-to-Package Contract"
sectionSlug: how-do-workflows-jobs-runners-and-steps-fit-together
order: 1
revision: 3
---

## Current situation

A checkout-service workflow has split preparation, checks, and packaging into independent jobs.

## The issue

Checks cannot see the preparation workspace, while packaging can publish a failed candidate.

## Your task

Repair job ownership and dependencies. Run lint and unit checks on a prepared runner; package only after both pass. Each job must prepare its own workspace.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: healthy candidate; failed candidate cannot publish. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
