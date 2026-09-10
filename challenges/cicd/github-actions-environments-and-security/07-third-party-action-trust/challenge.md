---
retired: true
title: "Contain a Moving Action Reference"
sectionSlug: how-do-build-separation-pull-requests-and-third-party-actions-change-trust
order: 7
revision: 3
---

## Current situation

The lab catalog contains a reviewed immutable checkout revision and a movable tag.

## The issue

The tag may resolve to the authored compromised behavior, and validation currently exposes production secrets.

## Your task

Use the reviewed immutable catalog reference for checkout, remove release authority from validation, and keep production gated. The catalog SHA is a synthetic training identity, not a recommended public revision.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: catalog unchanged; movable tag compromised. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
