---
retired: true
title: "Select Relevant Changes Without Opening Deployment"
sectionSlug: how-do-repository-events-and-filters-select-work
order: 2
revision: 3
---

## Current situation

Backend validation and packaging share a workflow in a repository containing backend and documentation.

## The issue

The current trigger runs on every push, misses pull requests, and packages feature changes.

## Your task

Validate backend pull requests targeting main and backend pushes to main. Package only main pushes. Docs-only changes and pushes to feature branches must create no jobs.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: backend main push; backend pull request; docs-only push; feature branch push. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
