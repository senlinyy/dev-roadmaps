---
retired: true
title: "Keep Contributor Code Out of the Release Boundary"
sectionSlug: how-do-build-separation-pull-requests-and-third-party-actions-change-trust
order: 6
revision: 3
---

## Current situation

External contributors can modify the application and scripts. The current privileged PR-target workflow checks out their head.

## The issue

Untrusted code runs inside a job with production authority.

## Your task

Use ordinary pull_request validation with read-only authority. Build and release only trusted main pushes, using the protected environment and cloud trust. PR-target events must not execute this workflow.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: trusted main push; external contributor pr; privileged pr-target event. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
