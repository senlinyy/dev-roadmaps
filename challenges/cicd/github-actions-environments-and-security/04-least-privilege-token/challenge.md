---
retired: true
title: "Repair the 403 Without Giving CI Write-All"
sectionSlug: how-should-github_token-be-narrowed
order: 4
revision: 3
---

## Current situation

A reporting job receives 403 while the source-validation job can write broadly.

## The issue

Authority is attached to the wrong job; simply broadening everything would hide the mistake.

## Your task

Keep validation read-only, move status publishing to a downstream report job, and grant only checks: write there. A failed test must not publish success.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: status may publish; no success for failed tests. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
