---
retired: true
title: "Publish the Right Result with the Right Authority"
sectionSlug: how-do-contexts-variables-and-expressions-provide-data
order: 3
revision: 3
---

## Current situation

The status publisher reports a branch label instead of the checked commit and runs with repository-wide write permissions.

## The issue

Status identity is misleading, and application validation receives unnecessary write authority.

## Your task

Publish the current SHA through step and job outputs, consume it downstream, and scope checks: write to the report job. Validation must remain read-only.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: current commit; different commit; failed tests withhold success. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
