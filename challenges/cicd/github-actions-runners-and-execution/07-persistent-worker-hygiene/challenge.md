---
retired: true
title: "Remove Residue Across a Reused Worker Lifecycle"
sectionSlug: why-is-runner-choice-a-security-decision
order: 7
revision: 3
---

## Current situation

A reused worker contains stale build files and dummy credential references from an earlier job.

## The issue

Checkout cleaning is disabled and failures skip cleanup.

## Your task

Clean the starting checkout, validate and build, then run the supplied cleanup script even after failure. Keep this lab on the legacy worker so the lifecycle repair is demonstrated.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: dirty reused workspace; test fails after checkout. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
