---
retired: true
title: "Delay Production Authority Until Approval"
sectionSlug: how-do-secret-scopes-environments-and-protection-rules-delay-authority
order: 1
revision: 3
---

## Current situation

Production uses a protected environment and a release-manager approval.

## The issue

The job bypasses the environment; settings accept feature branches and self-approval.

## Your task

Bind the release job to production and repair its separate settings. Only main with an independent release-manager approval may execute deployment. Keep validation and packaging outside production authority.

Edit the workflow and `environment-settings.json`. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: approved main release; approval not granted; author attempts self-approval; feature push excluded. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
