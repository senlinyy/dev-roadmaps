---
retired: true
title: "Cancel Stale Checks, Serialize Production"
sectionSlug: how-do-matrix-jobs-and-concurrency-control-expanded-work
order: 7
revision: 3
---

## Current situation

Two updates to PR 7 overlap with a separate update to PR 8.

## The issue

A repository-wide concurrency group cancels unrelated review work.

## Your task

Cancel only older checks for the same PR. Preserve PR 8 while the newer PR 7 result supersedes its predecessor. The supplied timeline contains at most two arrivals per group. For main pushes, serialize production under deploy-production without cancelling an in-progress release; use an artifact upload/download even within this timing fixture.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: two prs overlap; two overlapping production requests. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
