---
retired: true
title: "Keep Failure Evidence and Transfer Release Bytes"
sectionSlug: how-do-setup-actions-caches-and-artifacts-cross-runner-lifecycles
order: 6
revision: 3
---

## Current situation

Test reports disappear when a job fails, and a consumer expects another runner’s build directory.

## The issue

Report uploading is skipped on failure; the consumer rebuilds rather than downloading the tested artifact.

## Your task

Retain reports after either test outcome. Build and upload app only after passing tests, then consume it in a separate release job without checkout or rebuild.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: passing tests; failed tests still retain reports. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
