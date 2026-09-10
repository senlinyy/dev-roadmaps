---
retired: true
title: "Make a Clean Runner Reproducible"
sectionSlug: how-do-checkout-and-dependency-installation-materialize-a-workspace
order: 1
revision: 3
---

## Current situation

A developer machine passes tests, but hosted workers start without repository files or Node setup.

## The issue

Preparation happens in a different job and uses an unlocked install.

## Your task

Rebuild each job’s preparation sequence with checkout, Node 24, and locked installation. Keep packaging downstream of lint and unit checks.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: fresh worker; unit failure. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
